import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivitySchema, type Activity } from "@camporee-conductor/schema";
import type { InferResponseType } from "hono/client";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useBlocker, useParams } from "react-router";
import { ApiError, client, data } from "../api.ts";
import {
  moveItem,
  removeItem,
  renameVariable,
  replaceItem,
  withOptional,
} from "../draft.ts";
import { ui } from "../ui.ts";
import { useOpenHtmlInNewTab } from "../useOpenHtmlInNewTab.ts";
import { Loading, PageError } from "./ErrorMessage.tsx";

type ActivityRead = InferResponseType<
  (typeof client.api.activities)[":activityId"]["$get"],
  200
>;
type Content = Activity["content"];
type Supply = Content["supplies"][number];
type CustomSection = NonNullable<Content["customSections"]>[number];

/**
 * One Activity's text (#6 PR 3): title, tags, every content section, supplies, custom sections and variables.
 * Editors and owners change a draft and save it whole with If-Match (ADR-0029); viewers see the same form,
 * read-only. An emptied list or set stays in the document, empty, so it's visibly empty (Jim, 2026-11-11);
 * only a supply's group is removed when blank, since the schema allows no empty group. Scoring fields come in PR 5.
 */
export function ActivityPage() {
  const { eventId = "", activityId = "" } = useParams();
  const result = useQuery({
    queryKey: ["activities", activityId],
    queryFn: () =>
      data(
        client.api.activities[":activityId"].$get({ param: { activityId } }),
      ),
    // A background refetch would replace the draft; the page reloads only when asked (after a stale save).
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  if (result.isPending) return <Loading />;
  if (result.isError) return <PageError error={result.error} />;
  // A new key after each save or reload starts a fresh draft from what's stored.
  return (
    <Editor
      key={result.data.updatedAt}
      eventId={eventId}
      activityId={activityId}
      read={result.data}
    />
  );
}

function Editor({
  eventId,
  activityId,
  read,
}: {
  eventId: string;
  activityId: string;
  read: ActivityRead;
}) {
  const stored = read.activity as Activity;
  const canEdit = read.role === "owner" || read.role === "editor";
  const [draft, setDraft] = useState<Activity>(stored);
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);
  const check = ActivitySchema.safeParse(draft);
  const issues = check.success
    ? []
    : check.error.issues.map(
        (i) =>
          `${i.path.length > 0 ? `${i.path.map(String).join(".")}: ` : ""}${i.message}`,
      );

  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      data(
        client.api.activities[":activityId"].$put(
          { param: { activityId }, json: draft },
          { headers: { "if-match": String(read.updatedAt) } },
        ),
      ),
    onSuccess: ({ updatedAt }) => {
      queryClient.setQueryData<ActivityRead>(["activities", activityId], {
        ...read,
        activity: draft as ActivityRead["activity"],
        updatedAt,
      });
      return queryClient.invalidateQueries({ queryKey: ["events", eventId] });
    },
  });
  const reload = () =>
    queryClient.invalidateQueries({ queryKey: ["activities", activityId] });

  useLeaveWarning(dirty && !save.isPending);

  const content = draft.content;
  const setContent = (patch: Partial<Content>) =>
    setDraft({ ...draft, content: { ...content, ...patch } });

  return (
    <div className="space-y-6 pb-24">
      <div className="space-y-1">
        <p>
          <Link to={`/events/${eventId}`} className={ui.link}>
            ← Back to the Event
          </Link>
        </p>
        <h1 className={ui.h1}>{stored.title}</h1>
        <p className={ui.muted}>
          {stored.scoringType === "ranked" ? "Ranked" : "Exhibition"} ·{" "}
          {stored.scoring.fields.length} scoring{" "}
          {stored.scoring.fields.length === 1 ? "field" : "fields"} · Text is
          Markdown: **bold**, *italic*, lists and links.
        </p>
        <PreviewGuide eventId={eventId} activityId={activityId} dirty={dirty} />
      </div>

      <fieldset disabled={!canEdit} className="space-y-6">
        <Card title="Name and tags">
          <Text
            label="Title"
            value={draft.title}
            onChange={(title) => setDraft({ ...draft, title })}
          />
          <StringList
            label="Tags"
            item="tag"
            items={draft.tags ?? []}
            multiline={false}
            onChange={(tags) => setDraft({ ...draft, tags })}
          />
        </Card>

        <Card title="The script">
          <Area
            label="Background (story)"
            value={content.story}
            onChange={(story) => setContent({ story })}
          />
          <Area
            label="The Objective"
            value={content.objective}
            onChange={(objective) => setContent({ objective })}
          />
        </Card>

        <Card title="The Judge's playbook">
          <Area
            label="Instructions"
            rows={10}
            value={content.description}
            onChange={(description) => setContent({ description })}
          />
          <StringList
            label="Rules & Constraints"
            item="rule"
            items={content.rules}
            multiline
            onChange={(rules) => setContent({ rules })}
          />
          <Area
            label="Scoring Overview"
            value={content.timeAndScoring}
            onChange={(timeAndScoring) => setContent({ timeAndScoring })}
          />
          <Area
            label="Notes & Background"
            value={content.notes}
            onChange={(notes) => setContent({ notes })}
          />
          <CustomSections
            sections={content.customSections ?? []}
            onChange={(sections) =>
              setDraft({
                ...draft,
                content: { ...content, customSections: sections },
              })
            }
          />
        </Card>

        <Card title="Logistics and setup">
          <Area
            label="Setup Instructions"
            value={content.setup}
            onChange={(setup) => setContent({ setup })}
          />
          <Area
            label="Station Reset"
            value={content.reset}
            onChange={(reset) => setContent({ reset })}
          />
          <Area
            label="Staffing"
            value={content.staffing}
            onChange={(staffing) => setContent({ staffing })}
          />
          <Supplies
            supplies={content.supplies}
            onChange={(supplies) => setContent({ supplies })}
          />
        </Card>

        <Card title="Variables">
          <p className={ui.muted}>
            Values for <code>{"{{name}}"}</code> in this Competition's Common
            Field labels, e.g. <code>ten_essentials</code>.
          </p>
          <Variables
            variables={draft.variables ?? {}}
            onChange={(variables) => setDraft({ ...draft, variables })}
          />
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
            setDraft(stored);
          }}
          onReload={() => {
            save.reset();
            void reload();
          }}
        />
      )}
    </div>
  );
}

/** Warns before leaving with unsaved changes: another page in the app, or closing or reloading the tab. */
function useLeaveWarning(when: boolean) {
  const blocker = useBlocker(when);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("You have unsaved changes. Leave without saving?")) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    if (!when) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [when]);
}

function SaveBar({
  dirty,
  issues,
  saving,
  error,
  onSave,
  onDiscard,
  onReload,
}: {
  dirty: boolean;
  issues: string[];
  saving: boolean;
  error: Error | null;
  onSave: () => void;
  onDiscard: () => void;
  onReload: () => void;
}) {
  const stale = error instanceof ApiError && error.status === 409;
  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white/95 px-4 py-3 shadow">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
        <span role="status" className="text-sm text-stone-700">
          {saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <button
          type="button"
          className={ui.button}
          disabled={!dirty || saving || issues.length > 0}
          onClick={onSave}
        >
          Save
        </button>
        <button
          type="button"
          className={ui.buttonQuiet}
          disabled={!dirty || saving}
          onClick={onDiscard}
        >
          Discard changes
        </button>
        {issues.length > 0 && (
          <ul role="alert" className={`${ui.error} w-full list-disc pl-6`}>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
        {error && (
          <div
            role="alert"
            className={`${ui.error} flex w-full flex-wrap items-center gap-3`}
          >
            <span className="whitespace-pre-line">{error.message}</span>
            {stale && (
              <button
                type="button"
                className={ui.buttonQuiet}
                onClick={onReload}
              >
                Reload (drops your changes)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Opens the Activity's guide (#44): the saved version, so it says so while there are unsaved changes. */
function PreviewGuide({
  eventId,
  activityId,
  dirty,
}: {
  eventId: string;
  activityId: string;
  dirty: boolean;
}) {
  const { open, opening, error } = useOpenHtmlInNewTab(
    () =>
      client.api.events[":eventId"]["activity-guides"].$get({
        param: { eventId },
        query: { ids: activityId },
      }),
    "Couldn't load the guide.",
  );
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      <button
        type="button"
        className={ui.buttonQuiet}
        onClick={() => void open()}
        disabled={opening}
      >
        Preview guide
      </button>
      {dirty && <span className={ui.muted}>Shows the last saved version.</span>}
      {error && (
        <span role="alert" className={ui.error}>
          {error}
        </span>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${ui.card} space-y-4`} aria-label={title}>
      <h2 className={ui.h2}>{title}</h2>
      {children}
    </section>
  );
}

function Text({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={ui.label}>
      {label}
      <input
        className={ui.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Area({
  label,
  value,
  rows = 4,
  onChange,
}: {
  label: string;
  value: string;
  rows?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className={ui.label}>
      {label}
      <textarea
        className={`${ui.input} font-mono text-sm`}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** Up, down and remove for one row of a list editor. */
function RowButtons({
  name,
  index,
  count,
  onMove,
  onRemove,
}: {
  name: string;
  index: number;
  count: number;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}) {
  const small =
    "rounded border border-stone-300 px-1.5 text-xs hover:bg-stone-100 disabled:opacity-40";
  return (
    <span className="flex gap-1">
      <button
        type="button"
        className={small}
        aria-label={`Move ${name} up`}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        ↑
      </button>
      <button
        type="button"
        className={small}
        aria-label={`Move ${name} down`}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        ↓
      </button>
      <button
        type="button"
        className={`${small} text-red-700`}
        aria-label={`Remove ${name}`}
        onClick={onRemove}
      >
        ✕
      </button>
    </span>
  );
}

function StringList({
  label,
  item,
  items,
  multiline,
  onChange,
}: {
  label: string;
  item: string;
  items: string[];
  multiline: boolean;
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-stone-700">{label}</h3>
      <ol className="space-y-2">
        {items.map((value, index) => {
          const name = `${item} ${index + 1}`;
          const set = (v: string) => onChange(replaceItem(items, index, v));
          return (
            <li key={index} className="flex items-start gap-2">
              {multiline ? (
                <textarea
                  className={`${ui.input} flex-1 font-mono text-sm`}
                  rows={2}
                  aria-label={name}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                />
              ) : (
                <input
                  className={`${ui.input} flex-1`}
                  aria-label={name}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                />
              )}
              <RowButtons
                name={name}
                index={index}
                count={items.length}
                onMove={(step) => onChange(moveItem(items, index, step))}
                onRemove={() => onChange(removeItem(items, index))}
              />
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className={ui.buttonQuiet}
        onClick={() => onChange([...items, ""])}
      >
        + Add {item}
      </button>
    </div>
  );
}

function Supplies({
  supplies,
  onChange,
}: {
  supplies: Supply[];
  onChange: (supplies: Supply[]) => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-stone-700">Supplies</h3>
      <p className={ui.muted}>
        Items with the same group are listed under it, e.g. "Scene Props".
      </p>
      <ol className="space-y-2">
        {supplies.map((supply, index) => {
          const name = `supply ${index + 1}`;
          const set = (s: Supply) => onChange(replaceItem(supplies, index, s));
          return (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <input
                className={`${ui.input} w-36`}
                aria-label={`Group of ${name}`}
                placeholder="Group (optional)"
                value={supply.group ?? ""}
                onChange={(e) =>
                  set(withOptional(supply, "group", e.target.value))
                }
              />
              <input
                className={`${ui.input} min-w-40 flex-1`}
                aria-label={`Item of ${name}`}
                placeholder="Item"
                value={supply.item}
                onChange={(e) => set({ ...supply, item: e.target.value })}
              />
              <input
                className={`${ui.input} w-28`}
                aria-label={`Quantity of ${name}`}
                placeholder="Quantity"
                value={supply.quantity ?? ""}
                onChange={(e) => set({ ...supply, quantity: e.target.value })}
              />
              <RowButtons
                name={name}
                index={index}
                count={supplies.length}
                onMove={(step) => onChange(moveItem(supplies, index, step))}
                onRemove={() => onChange(removeItem(supplies, index))}
              />
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className={ui.buttonQuiet}
        onClick={() =>
          onChange([
            ...supplies,
            // A new item starts in the last item's group, the usual next entry.
            withOptional<Supply, "group">(
              { item: "" },
              "group",
              supplies.at(-1)?.group,
            ),
          ])
        }
      >
        + Add supply
      </button>
    </div>
  );
}

function CustomSections({
  sections,
  onChange,
}: {
  sections: CustomSection[];
  onChange: (sections: CustomSection[]) => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-stone-700">Extra sections</h3>
      <p className={ui.muted}>
        Printed after the playbook, e.g. "Scoring Notes".
      </p>
      <ol className="space-y-3">
        {sections.map((section, index) => {
          const name = `section ${index + 1}`;
          const set = (s: CustomSection) =>
            onChange(replaceItem(sections, index, s));
          return (
            <li
              key={index}
              className="space-y-2 rounded-md border border-stone-200 p-3"
            >
              <div className="flex items-center gap-2">
                <input
                  className={`${ui.input} flex-1`}
                  aria-label={`Title of ${name}`}
                  placeholder="Section title"
                  value={section.title}
                  onChange={(e) => set({ ...section, title: e.target.value })}
                />
                <RowButtons
                  name={name}
                  index={index}
                  count={sections.length}
                  onMove={(step) => onChange(moveItem(sections, index, step))}
                  onRemove={() => onChange(removeItem(sections, index))}
                />
              </div>
              <textarea
                className={`${ui.input} w-full font-mono text-sm`}
                rows={4}
                aria-label={`Text of ${name}`}
                value={section.body}
                onChange={(e) => set({ ...section, body: e.target.value })}
              />
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className={ui.buttonQuiet}
        onClick={() => onChange([...sections, { title: "", body: "" }])}
      >
        + Add section
      </button>
    </div>
  );
}

function Variables({
  variables,
  onChange,
}: {
  variables: Record<string, string>;
  onChange: (variables: Record<string, string>) => void;
}) {
  const entries = Object.entries(variables);
  const add = () => {
    let name = "new_variable";
    for (let n = 2; name in variables; n++) name = `new_variable_${n}`;
    onChange({ ...variables, [name]: "" });
  };
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {entries.map(([name, value]) => (
          <VariableRow
            key={name}
            name={name}
            value={value}
            onRename={(to) => onChange(renameVariable(variables, name, to))}
            onValue={(v) => onChange({ ...variables, [name]: v })}
            onRemove={() =>
              onChange(
                Object.fromEntries(entries.filter(([key]) => key !== name)),
              )
            }
          />
        ))}
      </ul>
      <button type="button" className={ui.buttonQuiet} onClick={add}>
        + Add variable
      </button>
    </div>
  );
}

/** The name is renamed when you leave its box, so typing never collides with another variable halfway. */
function VariableRow({
  name,
  value,
  onRename,
  onValue,
  onRemove,
}: {
  name: string;
  value: string;
  onRename: (to: string) => void;
  onValue: (value: string) => void;
  onRemove: () => void;
}) {
  const [typed, setTyped] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    try {
      onRename(typed.trim());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-2">
      <input
        className={`${ui.input} w-48 font-mono text-sm`}
        aria-label={`Name of variable ${name}`}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      <input
        className={`${ui.input} min-w-40 flex-1`}
        aria-label={`Value of ${name}`}
        value={value}
        onChange={(e) => onValue(e.target.value)}
      />
      <button
        type="button"
        className="rounded border border-stone-300 px-1.5 text-xs text-red-700 hover:bg-stone-100"
        aria-label={`Remove variable ${name}`}
        onClick={onRemove}
      >
        ✕
      </button>
      {error && (
        <span role="alert" className={`${ui.error} w-full`}>
          {error}
        </span>
      )}
    </li>
  );
}
