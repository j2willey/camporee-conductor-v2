import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EventSchema,
  type Award,
  type Competition,
  type Event,
} from "@camporee-conductor/schema";
import { DEFAULT_PLACEMENT_POINTS } from "@camporee-conductor/scoring";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { client, data } from "../api.ts";
import {
  addAward,
  addCompetition,
  addDivision,
  moveCompetition,
  removeCompetition,
  setRuleType,
  updateCompetition,
} from "../competitions.ts";
import { moveItem, omit, removeItem, replaceItem } from "../draft.ts";
import { ui } from "../ui.ts";
import type { EventRead } from "./ActivityList.tsx";
import {
  Card,
  RowButtons,
  SaveBar,
  Text,
  useLeaveWarning,
} from "./editing.tsx";
import { Loading, PageError } from "./ErrorMessage.tsx";

/**
 * An Event's Competitions and Awards (#6 PR 6): label, level, registration, Divisions, placement points and
 * Program Guide listing; Awards by places, top percent or by hand. Edits a draft of the Event and saves it whole
 * with If-Match (ADR-0029). Common Fields are chosen in #99.
 */
export function CompetitionsPage() {
  const { eventId = "" } = useParams();
  const result = useQuery({
    queryKey: ["events", eventId],
    queryFn: () =>
      data(client.api.events[":eventId"].$get({ param: { eventId } })),
    // A background refetch would replace the draft; the page reloads only when asked.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  if (result.isPending) return <Loading />;
  if (result.isError) return <PageError error={result.error} />;
  return (
    <Editor key={result.data.updatedAt} eventId={eventId} read={result.data} />
  );
}

function Editor({ eventId, read }: { eventId: string; read: EventRead }) {
  const stored = read.event as Event;
  const canEdit = read.role === "owner" || read.role === "editor";
  const [draft, setDraft] = useState<Event>(stored);
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);
  const check = EventSchema.safeParse(draft);
  const issues = check.success
    ? []
    : check.error.issues.map(
        (i) =>
          `${i.path.length > 0 ? `${i.path.map(String).join(".")}: ` : ""}${i.message}`,
      );
  const [removeProblem, setRemoveProblem] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      data(
        client.api.events[":eventId"].$put(
          { param: { eventId }, json: draft },
          { headers: { "if-match": String(read.updatedAt) } },
        ),
      ),
    onSuccess: ({ updatedAt }) =>
      queryClient.setQueryData<EventRead>(["events", eventId], {
        ...read,
        event: draft as EventRead["event"],
        updatedAt,
      }),
  });
  useLeaveWarning(dirty && !save.isPending);

  const counts = new Map<string, number>();
  for (const a of draft.activities) {
    counts.set(a.competitionId, (counts.get(a.competitionId) ?? 0) + 1);
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="space-y-1">
        <p>
          <Link to={`/events/${eventId}`} className={ui.link}>
            ← Back to the Event
          </Link>
        </p>
        <h1 className={ui.h1}>Competitions and Awards</h1>
        <p className={ui.muted}>{stored.title}</p>
      </div>

      <fieldset disabled={!canEdit} className="space-y-6">
        {draft.competitions.map((competition, index) => (
          <CompetitionEditor
            key={competition.id}
            competition={competition}
            activities={counts.get(competition.id) ?? 0}
            index={index}
            count={draft.competitions.length}
            onChange={(change) =>
              setDraft(updateCompetition(draft, index, change))
            }
            onAddDivision={() => setDraft(addDivision(draft, index))}
            onMove={(step) => setDraft(moveCompetition(draft, index, step))}
            onRemove={() => {
              const removed = removeCompetition(draft, competition.id);
              if (!removed.ok) {
                setRemoveProblem(
                  `Can't remove ${competition.label}: ${removed.problem}`,
                );
                return;
              }
              const awards = (draft.awards ?? []).filter(
                (a) => a.competitionId === competition.id,
              ).length;
              if (
                awards > 0 &&
                !window.confirm(
                  `Remove ${competition.label} and its ${awards} ${awards === 1 ? "Award" : "Awards"}?`,
                )
              ) {
                return;
              }
              setRemoveProblem(null);
              setDraft(removed.event);
            }}
          />
        ))}
        {removeProblem && (
          <p role="alert" className={ui.error}>
            {removeProblem}
          </p>
        )}
        <button
          type="button"
          className={ui.buttonQuiet}
          onClick={() => setDraft(addCompetition(draft, "New Competition"))}
        >
          + Add Competition
        </button>

        <Card title="Awards">
          <p className={ui.muted}>
            Recognition drawn from a Competition's standings, e.g. 1st–3rd
            place, or the top 25%.
          </p>
          <ol className="space-y-3">
            {(draft.awards ?? []).map((award, index, awards) => (
              <AwardEditor
                key={award.id}
                award={award}
                index={index}
                count={awards.length}
                competitions={draft.competitions}
                onChange={(next) =>
                  setDraft({
                    ...draft,
                    awards: replaceItem(awards, index, next),
                  })
                }
                onMove={(step) =>
                  setDraft({ ...draft, awards: moveItem(awards, index, step) })
                }
                onRemove={() =>
                  setDraft({ ...draft, awards: removeItem(awards, index) })
                }
              />
            ))}
          </ol>
          {draft.competitions[0] && (
            <button
              type="button"
              className={ui.buttonQuiet}
              onClick={() =>
                setDraft(addAward(draft, draft.competitions[0]?.id ?? ""))
              }
            >
              + Add award
            </button>
          )}
        </Card>
      </fieldset>

      {canEdit && (
        <SaveBar
          dirty={dirty}
          issues={issues}
          saving={save.isPending}
          error={save.error}
          onSave={() => save.mutate()}
          onDiscard={() => {
            save.reset();
            setRemoveProblem(null);
            setDraft(stored);
          }}
          onReload={() => {
            save.reset();
            void queryClient.invalidateQueries({
              queryKey: ["events", eventId],
            });
          }}
        />
      )}
    </div>
  );
}

function CompetitionEditor({
  competition,
  activities,
  index,
  count,
  onChange,
  onAddDivision,
  onMove,
  onRemove,
}: {
  competition: Competition;
  activities: number;
  index: number;
  count: number;
  onChange: (change: (c: Competition) => Competition) => void;
  onAddDivision: () => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}) {
  const name = competition.label || `Competition ${index + 1}`;
  const listed = competition.programGuide?.listActivities !== false;
  const points = competition.placementPoints;
  const common = competition.commonFields;
  return (
    <section
      className={`${ui.card} space-y-4`}
      aria-label={`Competition: ${name}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={ui.h2}>
          {name}{" "}
          <span className="text-sm font-normal text-stone-500">
            ({activities} {activities === 1 ? "Activity" : "Activities"})
          </span>
        </h2>
        <RowButtons
          name={name}
          index={index}
          count={count}
          onMove={onMove}
          onRemove={onRemove}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Text
          label="Label (names its Activities on screen, e.g. Patrol Games)"
          value={competition.label}
          onChange={(label) => onChange((c) => ({ ...c, label }))}
        />
        <Text
          label="Slug"
          value={competition.slug}
          onChange={(slug) => onChange((c) => ({ ...c, slug }))}
        />
        <label className={ui.label}>
          Who competes
          <select
            className={ui.input}
            value={competition.level}
            onChange={(e) =>
              onChange((c) => ({
                ...c,
                level: e.target.value as Competition["level"],
              }))
            }
          >
            <option value="team">Teams (e.g. Patrols)</option>
            <option value="group">Groups (e.g. Troops)</option>
          </select>
        </label>
        <label className={ui.label}>
          Entrants
          <select
            className={ui.input}
            value={competition.registration}
            onChange={(e) =>
              onChange((c) => ({
                ...c,
                registration: e.target.value as Competition["registration"],
              }))
            }
          >
            <option value="registered">From the roster</option>
            <option value="open">Typed in by the Judge</option>
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={listed}
          onChange={(e) =>
            onChange((c) => ({
              ...c,
              programGuide: { listActivities: e.target.checked },
            }))
          }
        />
        List its Activities in the Program Guide
      </label>

      <PlacementPoints
        points={points}
        onChange={(next) =>
          onChange((c) =>
            next === undefined
              ? omit(c, "placementPoints")
              : { ...c, placementPoints: next },
          )
        }
      />

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-stone-700">Divisions</h3>
        <p className={ui.muted}>
          Optional: rank entrants separately, e.g. by age. Officials put Teams
          in Divisions on the Collator.
        </p>
        <ol className="space-y-2">
          {competition.divisions.map((division, i) => (
            <li key={division.id} className="flex flex-wrap items-center gap-2">
              <input
                className={`${ui.input} flex-1`}
                aria-label={`Label of ${name} division ${i + 1}`}
                value={division.label}
                onChange={(e) =>
                  onChange((c) => ({
                    ...c,
                    divisions: replaceItem(c.divisions, i, {
                      ...division,
                      label: e.target.value,
                    }),
                  }))
                }
              />
              <input
                className={`${ui.input} w-40 font-mono text-sm`}
                aria-label={`Slug of ${name} division ${i + 1}`}
                value={division.slug}
                onChange={(e) =>
                  onChange((c) => ({
                    ...c,
                    divisions: replaceItem(c.divisions, i, {
                      ...division,
                      slug: e.target.value,
                    }),
                  }))
                }
              />
              <RowButtons
                name={`${name} division ${i + 1}`}
                index={i}
                count={competition.divisions.length}
                onMove={(step) =>
                  onChange((c) => ({
                    ...c,
                    divisions: moveItem(c.divisions, i, step),
                  }))
                }
                onRemove={() =>
                  onChange((c) => ({
                    ...c,
                    divisions: removeItem(c.divisions, i),
                  }))
                }
              />
            </li>
          ))}
        </ol>
        <button
          type="button"
          className={ui.buttonQuiet}
          aria-label={`Add a division to ${name}`}
          onClick={onAddDivision}
        >
          + Add division
        </button>
      </div>

      <p className={ui.muted}>
        Common Fields:{" "}
        {common
          ? `${common.before.length} before and ${common.after.length} after each Activity's own fields.`
          : "none."}{" "}
        (Chosen in the Common Fields editor, coming in #99.)
      </p>
    </section>
  );
}

/**
 * Placement points (ADR-0019): the default table, or the Competition's own. Typed as numbers separated by commas;
 * the draft only changes when the text reads as numbers, so a half-typed list doesn't jump.
 */
function PlacementPoints({
  points,
  onChange,
}: {
  points: Competition["placementPoints"];
  onChange: (points: Competition["placementPoints"]) => void;
}) {
  const [places, setPlaces] = useState(points?.places.join(", ") ?? "");
  const own = points !== undefined;
  const defaults = `${DEFAULT_PLACEMENT_POINTS.places.join("/")}, and ${DEFAULT_PLACEMENT_POINTS.participation} for taking part`;
  const read = (text: string) =>
    text
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== "")
      .map(Number);
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-stone-700">Placement points</h3>
      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={own}
          onChange={(e) => {
            if (!e.target.checked) return onChange(undefined);
            setPlaces(DEFAULT_PLACEMENT_POINTS.places.join(", "));
            onChange({
              places: [...DEFAULT_PLACEMENT_POINTS.places],
              participation: DEFAULT_PLACEMENT_POINTS.participation,
            });
          }}
        />
        Its own points, instead of the default ({defaults})
      </label>
      {own && (
        <div className="flex flex-wrap gap-3">
          <label className={`${ui.label} min-w-48 flex-1`}>
            1st, 2nd, 3rd… (commas between)
            <input
              className={ui.input}
              value={places}
              onChange={(e) => {
                setPlaces(e.target.value);
                const numbers = read(e.target.value);
                if (numbers.length > 0 && numbers.every(Number.isFinite)) {
                  onChange({ ...points, places: numbers });
                }
              }}
            />
          </label>
          <label className={`${ui.label} w-36`}>
            Taking part
            <input
              className={ui.input}
              type="number"
              min={0}
              value={points.participation}
              onChange={(e) =>
                onChange({
                  ...points,
                  participation: Number(e.target.value) || 0,
                })
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}

function AwardEditor({
  award,
  index,
  count,
  competitions,
  onChange,
  onMove,
  onRemove,
}: {
  award: Award;
  index: number;
  count: number;
  competitions: Competition[];
  onChange: (award: Award) => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}) {
  const name = `award ${index + 1}`;
  const { rule } = award;
  const competition = competitions.find((c) => c.id === award.competitionId);
  return (
    <li
      className="space-y-3 rounded-md border border-stone-200 p-3"
      aria-label={`Award: ${award.label}`}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className={`${ui.label} min-w-48 flex-1`}>
          Name
          <input
            className={ui.input}
            aria-label={`Name of ${name}`}
            value={award.label}
            onChange={(e) => onChange({ ...award, label: e.target.value })}
          />
        </label>
        <label className={ui.label}>
          Slug
          <input
            className={`${ui.input} w-36 font-mono text-sm`}
            aria-label={`Slug of ${name}`}
            value={award.slug}
            onChange={(e) => onChange({ ...award, slug: e.target.value })}
          />
        </label>
        <RowButtons
          name={name}
          index={index}
          count={count}
          onMove={onMove}
          onRemove={onRemove}
        />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className={ui.label}>
          From the standings of
          <select
            className={ui.input}
            aria-label={`Competition of ${name}`}
            value={award.competitionId}
            onChange={(e) =>
              onChange({ ...award, competitionId: e.target.value })
            }
          >
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.label}>
          For
          <select
            className={ui.input}
            aria-label={`Scope of ${name}`}
            value={award.scope}
            onChange={(e) =>
              onChange({
                ...award,
                scope: e.target.value as Award["scope"],
              })
            }
          >
            <option value="event">The whole Competition</option>
            <option value="division">
              Each Division
              {competition && competition.divisions.length === 0
                ? " (it has none yet)"
                : ""}
            </option>
          </select>
        </label>
        <label className={ui.label}>
          Who gets it
          <select
            className={ui.input}
            aria-label={`Rule of ${name}`}
            value={rule.type}
            onChange={(e) =>
              onChange({
                ...award,
                rule: setRuleType(
                  rule,
                  e.target.value as Award["rule"]["type"],
                ),
              })
            }
          >
            <option value="places">By place</option>
            <option value="top-percent">The top percent</option>
            <option value="manual">Officials choose</option>
          </select>
        </label>
        {rule.type === "top-percent" && (
          <label className={ui.label}>
            Percent
            <input
              className={`${ui.input} w-24`}
              aria-label={`Percent of ${name}`}
              type="number"
              min={1}
              max={100}
              value={rule.percent}
              onChange={(e) =>
                onChange({
                  ...award,
                  rule: { ...rule, percent: Number(e.target.value) },
                })
              }
            />
          </label>
        )}
      </div>
      {rule.type === "places" && (
        <label className={ui.label}>
          One line per place, 1st first (what's printed, e.g. Gold, Silver,
          Bronze)
          <textarea
            className={`${ui.input} text-sm`}
            aria-label={`Places of ${name}`}
            rows={3}
            value={rule.names.join("\n")}
            onChange={(e) =>
              onChange({
                ...award,
                rule: { ...rule, names: e.target.value.split("\n") },
              })
            }
          />
        </label>
      )}
      {rule.type === "top-percent" && (
        <p className={ui.muted}>
          Counted down the standings; ties at the line are included.
        </p>
      )}
      {rule.type === "manual" && (
        <p className={ui.muted}>
          Officials pick the recipients on the Collator.
        </p>
      )}
    </li>
  );
}
