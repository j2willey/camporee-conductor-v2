import { useQuery } from "@tanstack/react-query";
import { activityGuideNumbers } from "@camporee-conductor/program-guide";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { client, data } from "../api.ts";
import { ui } from "../ui.ts";
import { useOpenHtmlInNewTab } from "../useOpenHtmlInNewTab.ts";
import { Loading, PageError } from "./ErrorMessage.tsx";

/** Picks Activities and opens their guides, or their supplies list, as one print page (ADR-0028 items 8–10, #44). */
export function GuidesPage() {
  const { eventId = "" } = useParams();
  const result = useQuery({
    queryKey: ["events", eventId],
    queryFn: () =>
      data(client.api.events[":eventId"].$get({ param: { eventId } })),
  });
  if (result.isPending) return <Loading />;
  if (result.isError) return <PageError error={result.error} />;
  const { event, activities } = result.data;
  return (
    <GuidesPicker
      eventId={eventId}
      event={event}
      titles={new Map(activities.map((a) => [a.id, a.title]))}
    />
  );
}

type EventDoc = Parameters<typeof activityGuideNumbers>[0];

function GuidesPicker({
  eventId,
  event,
  titles,
}: {
  eventId: string;
  event: EventDoc;
  titles: Map<string, string>;
}) {
  const numbers = activityGuideNumbers(event);
  const groups = event.competitions.map((competition) => ({
    competition,
    entries: event.activities
      .filter(
        (a) => a.competitionId === competition.id && titles.has(a.activityId),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder),
  }));
  // Event order: Competition order, then sortOrder.
  const ordered = groups.flatMap((g) => g.entries.map((e) => e.activityId));
  const [picked, setPicked] = useState(() => new Set(ordered));
  const [twoSided, setTwoSided] = useState(true);
  const ids = ordered.filter((id) => picked.has(id));

  const { open, opening, error } = useOpenHtmlInNewTab(
    () =>
      client.api.events[":eventId"]["activity-guides"].$get({
        param: { eventId },
        query: { ids: ids.join(","), ...(twoSided ? { twoSided: "1" } : {}) },
      }),
    "Couldn't load the guides.",
  );
  const [perPage, setPerPage] = useState(false);
  const supplies = useOpenHtmlInNewTab(
    () =>
      client.api.events[":eventId"]["supplies-list"].$get({
        param: { eventId },
        query: { ids: ids.join(","), ...(perPage ? { perPage: "1" } : {}) },
      }),
    "Couldn't load the supplies list.",
  );

  function set(entryIds: string[], on: boolean) {
    setPicked((before) => {
      const next = new Set(before);
      for (const id of entryIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p>
          <Link to={`/events/${eventId}`} className={ui.link}>
            ← {event.title}
          </Link>
        </p>
        <h1 className={ui.h1}>Guides</h1>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map(({ competition, entries }) => {
          const entryIds = entries.map((e) => e.activityId);
          return (
            <section key={competition.id} className={ui.card}>
              <h2 className={`${ui.h2} mb-2`}>{competition.label}</h2>
              <p className="mb-2 flex gap-3 text-sm">
                <button
                  type="button"
                  className={ui.link}
                  aria-label={`All ${competition.label}`}
                  onClick={() => set(entryIds, true)}
                >
                  All
                </button>
                <button
                  type="button"
                  className={ui.link}
                  aria-label={`None of ${competition.label}`}
                  onClick={() => set(entryIds, false)}
                >
                  None
                </button>
              </p>
              <ul className="space-y-0.5 text-sm">
                {entries.map((entry) => (
                  <li key={entry.activityId}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={picked.has(entry.activityId)}
                        onChange={(e) =>
                          set([entry.activityId], e.target.checked)
                        }
                      />
                      {numbers.get(entry.activityId)}{" "}
                      {titles.get(entry.activityId)}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={twoSided}
            onChange={(e) => setTwoSided(e.target.checked)}
          />
          Two-sided (each guide starts on a right-hand page)
        </label>
        <button
          type="button"
          className={ui.button}
          disabled={ids.length === 0 || opening}
          onClick={() => void open()}
        >
          Open guides
        </button>
        {error && (
          <p role="alert" className={ui.error}>
            {error}
          </p>
        )}
      </div>
      <div className="space-y-3">
        <h2 className={ui.h2}>Supplies list</h2>
        <p className={ui.muted}>
          The same Activities&apos; supplies, per Activity (quantities
          aren&apos;t added up).
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={perPage}
            onChange={(e) => setPerPage(e.target.checked)}
          />
          One Activity per page
        </label>
        <button
          type="button"
          className={ui.buttonQuiet}
          disabled={ids.length === 0 || supplies.opening}
          onClick={() => void supplies.open()}
        >
          Open supplies list
        </button>
        {supplies.error && (
          <p role="alert" className={ui.error}>
            {supplies.error}
          </p>
        )}
      </div>
    </div>
  );
}
