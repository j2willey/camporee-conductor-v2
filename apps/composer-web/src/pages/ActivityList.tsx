import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isActivityEnabled } from "@camporee-conductor/schema";
import type { InferResponseType } from "hono/client";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { ApiError, client, data } from "../api.ts";
import { entriesOf, moveTo, moveWithin, setEnabled } from "../activity-list.ts";
import { ui } from "../ui.ts";
import { useOpenHtmlInNewTab } from "../useOpenHtmlInNewTab.ts";

/** What `GET /api/events/:eventId` answers. */
export type EventRead = InferResponseType<
  (typeof client.api.events)[":eventId"]["$get"],
  200
>;

/**
 * The Event's Activities, grouped by Competition (#6 PR 2b). Editors and owners add, duplicate, remove, reorder,
 * move and switch them on or off; viewers see the list only. Each change is one explicit click and saves at once
 * with If-Match (ADR-0029): there's nothing unsaved to lose. A stale save says so and offers a reload.
 */
export function ActivityList({
  eventId,
  read,
}: {
  eventId: string;
  read: EventRead;
}) {
  const { event, activities, updatedAt, role } = read;
  const canEdit = role === "owner" || role === "editor";
  const titles = new Map(activities.map((a) => [a.id, a.title]));
  const queryClient = useQueryClient();
  const reload = () =>
    queryClient.invalidateQueries({ queryKey: ["events", eventId] });
  const headers = { "if-match": String(updatedAt) };

  const change = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => reload(),
  });
  const busy = change.isPending;

  /** Saves a changed list. It shows at once, and goes back if the save is refused. */
  const saveList = (next: typeof event.activities) => {
    const changed = { ...event, activities: next };
    queryClient.setQueryData<EventRead>(["events", eventId], {
      ...read,
      event: changed,
    });
    change.mutate(
      () =>
        data(
          client.api.events[":eventId"].$put(
            { param: { eventId }, json: changed },
            { headers },
          ),
        ),
      {
        onError: () =>
          queryClient.setQueryData<EventRead>(["events", eventId], read),
      },
    );
  };
  const duplicate = (activityId: string) =>
    change.mutate(() =>
      data(
        client.api.events[":eventId"].activities[":activityId"].duplicate.$post(
          { param: { eventId, activityId } },
          { headers },
        ),
      ),
    );
  const remove = (activityId: string) => {
    const title = titles.get(activityId) ?? "this Activity";
    if (
      !window.confirm(
        `Remove "${title}" from this Event? Unless another Event uses it, the Activity is deleted.`,
      )
    ) {
      return;
    }
    change.mutate(() =>
      data(
        client.api.events[":eventId"].activities[":activityId"].$delete(
          { param: { eventId, activityId } },
          { headers },
        ),
      ),
    );
  };
  const add = (competitionId: string, title: string) =>
    new Promise<boolean>((resolve) =>
      change.mutate(
        () =>
          data(
            client.api.events[":eventId"].activities.$post(
              { param: { eventId }, json: { competitionId, title } },
              { headers },
            ),
          ),
        { onSuccess: () => resolve(true), onError: () => resolve(false) },
      ),
    );

  return (
    <div className="space-y-4">
      {change.error && (
        <ChangeError
          error={change.error}
          onReload={() => {
            change.reset();
            void reload();
          }}
        />
      )}
      {event.competitions.length === 0 && (
        <p className={ui.card}>
          No Competitions yet. Start with{" "}
          <Link to={`/events/${eventId}/competitions`} className={ui.link}>
            Competitions and Awards
          </Link>
          , e.g. Patrol Games; then add its Activities here.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {event.competitions.map((competition) => {
          const entries = entriesOf(event.activities, competition.id);
          const others = event.competitions.filter(
            (c) => c.id !== competition.id,
          );
          return (
            <section
              key={competition.id}
              className={ui.card}
              aria-label={competition.label}
            >
              <h2 className={`${ui.h2} mb-2`}>
                {competition.label} ({entries.length})
              </h2>
              <ol className="space-y-1 text-sm">
                {entries.map((entry, index) => {
                  const title = titles.get(entry.activityId);
                  const enabled = isActivityEnabled(entry);
                  return (
                    <li
                      key={entry.activityId}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1"
                    >
                      <span className="w-6 text-right text-stone-500">
                        {index + 1}.
                      </span>
                      {title === undefined ? (
                        <span>(missing Activity)</span>
                      ) : (
                        <Link
                          to={`/events/${eventId}/activities/${entry.activityId}`}
                          className={`${ui.link} ${enabled ? "" : "text-stone-500 line-through"}`}
                        >
                          {title}
                        </Link>
                      )}
                      {!enabled && (
                        <span className="text-stone-500">(disabled)</span>
                      )}
                      {title !== undefined && (
                        <ActivityGuideButton
                          eventId={eventId}
                          activityId={entry.activityId}
                          title={title}
                        />
                      )}
                      {canEdit && title !== undefined && (
                        <RowControls
                          title={title}
                          enabled={enabled}
                          first={index === 0}
                          last={index === entries.length - 1}
                          others={others}
                          busy={busy}
                          onMove={(step) =>
                            saveList(
                              moveWithin(
                                event.activities,
                                entry.activityId,
                                step,
                              ),
                            )
                          }
                          onMoveTo={(competitionId) =>
                            saveList(
                              moveTo(
                                event.activities,
                                entry.activityId,
                                competitionId,
                              ),
                            )
                          }
                          onEnabled={(on) =>
                            saveList(
                              setEnabled(
                                event.activities,
                                entry.activityId,
                                on,
                              ),
                            )
                          }
                          onDuplicate={() => duplicate(entry.activityId)}
                          onRemove={() => remove(entry.activityId)}
                        />
                      )}
                    </li>
                  );
                })}
              </ol>
              {canEdit && (
                <AddActivity
                  label={competition.label}
                  busy={busy}
                  onAdd={(title) => add(competition.id, title)}
                />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function RowControls({
  title,
  enabled,
  first,
  last,
  others,
  busy,
  onMove,
  onMoveTo,
  onEnabled,
  onDuplicate,
  onRemove,
}: {
  title: string;
  enabled: boolean;
  first: boolean;
  last: boolean;
  others: { id: string; label: string }[];
  busy: boolean;
  onMove: (step: -1 | 1) => void;
  onMoveTo: (competitionId: string) => void;
  onEnabled: (on: boolean) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const small = `${ui.link} text-xs disabled:opacity-40`;
  return (
    <span className="ml-auto flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-xs text-stone-600">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => onEnabled(e.target.checked)}
          aria-label={`${title} enabled`}
        />
        On
      </label>
      <IconButton
        label={`Move ${title} up`}
        disabled={busy || first}
        onClick={() => onMove(-1)}
      >
        ↑
      </IconButton>
      <IconButton
        label={`Move ${title} down`}
        disabled={busy || last}
        onClick={() => onMove(1)}
      >
        ↓
      </IconButton>
      {others.length > 0 && (
        <select
          className="rounded border border-stone-300 px-1 text-xs"
          aria-label={`Move ${title} to`}
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && onMoveTo(e.target.value)}
        >
          <option value="">Move to…</option>
          {others.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className={small}
        aria-label={`Duplicate ${title}`}
        disabled={busy}
        onClick={onDuplicate}
      >
        Duplicate
      </button>
      <button
        type="button"
        className={`${small} text-red-700`}
        aria-label={`Remove ${title}`}
        disabled={busy}
        onClick={onRemove}
      >
        Remove
      </button>
    </span>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="rounded border border-stone-300 px-1.5 text-xs hover:bg-stone-100 disabled:opacity-40"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** "Add Activity" opens a one-field form: the title. The rest starts as placeholder text (#6). */
function AddActivity({
  label,
  busy,
  onAdd,
}: {
  label: string;
  busy: boolean;
  onAdd: (title: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  if (!open) {
    return (
      <button
        type="button"
        className={`${ui.buttonQuiet} mt-3`}
        aria-label={`Add an Activity to ${label}`}
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        + Add Activity
      </button>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await onAdd(title)) {
      setTitle("");
      setOpen(false);
    }
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="mt-3 flex flex-wrap gap-2"
    >
      <input
        className={`${ui.input} flex-1`}
        aria-label={`Title of the new ${label} Activity`}
        placeholder="Title"
        value={title}
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
      />
      <button
        type="submit"
        className={ui.button}
        disabled={busy || title.trim() === ""}
      >
        Add
      </button>
      <button
        type="button"
        className={ui.buttonQuiet}
        onClick={() => {
          setTitle("");
          setOpen(false);
        }}
      >
        Cancel
      </button>
    </form>
  );
}

/** A refused change. A stale one (409) offers a reload, which shows the other person's changes. */
function ChangeError({
  error,
  onReload,
}: {
  error: Error;
  onReload: () => void;
}) {
  const stale = error instanceof ApiError && error.status === 409;
  return (
    <div
      role="alert"
      className={`${ui.error} flex flex-wrap items-center gap-3`}
    >
      <span>{error.message}</span>
      {stale && (
        <button type="button" className={ui.buttonQuiet} onClick={onReload}>
          Reload
        </button>
      )}
    </div>
  );
}

/** Opens one Activity's guide in a new tab (ADR-0028, issue #44). */
function ActivityGuideButton({
  eventId,
  activityId,
  title,
}: {
  eventId: string;
  activityId: string;
  title: string;
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
    <>
      <button
        type="button"
        className={`${ui.link} text-xs`}
        aria-label={`Guide for ${title}`}
        onClick={() => void open()}
        disabled={opening}
      >
        Guide
      </button>
      {error && (
        <span role="alert" className={`${ui.error} block`}>
          {error}
        </span>
      )}
    </>
  );
}
