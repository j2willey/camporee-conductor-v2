import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EventSchema, type Event } from "@camporee-conductor/schema";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { client, data } from "../api.ts";
import { ui } from "../ui.ts";
import type { EventRead } from "./ActivityList.tsx";
import { SaveBar, useLeaveWarning } from "./editing.tsx";
import { Loading, PageError } from "./ErrorMessage.tsx";

/** What a page that edits part of the Event gets: the draft, a way to change it, and whether it can. */
export interface EventPane {
  draft: Event;
  setDraft: (event: Event) => void;
  canEdit: boolean;
}

/**
 * A page that edits the Event (ADR-0029): loads it, keeps a draft, and saves it whole with If-Match, with the
 * Save bar and the leave warning. `children` draws the page's own part of the Event. Used by the Competitions
 * and Awards page (#6 PR 6) and Event details (#6 PR 7).
 */
export function EventEditorPage({
  heading,
  children,
  onDiscard,
}: {
  heading: string;
  children: (pane: EventPane) => ReactNode;
  /** Also clear anything the page keeps beside the draft. */
  onDiscard?: () => void;
}) {
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
  // A new key after each save or reload starts a fresh draft from what's stored.
  return (
    <Editor
      key={result.data.updatedAt}
      eventId={eventId}
      read={result.data}
      heading={heading}
      onDiscard={onDiscard}
    >
      {children}
    </Editor>
  );
}

function Editor({
  eventId,
  read,
  heading,
  children,
  onDiscard,
}: {
  eventId: string;
  read: EventRead;
  heading: string;
  children: (pane: EventPane) => ReactNode;
  onDiscard: (() => void) | undefined;
}) {
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

  return (
    <div className="space-y-6 pb-24">
      <div className="space-y-1">
        <p>
          <Link to={`/events/${eventId}`} className={ui.link}>
            ← Back to the Event
          </Link>
        </p>
        <h1 className={ui.h1}>{heading}</h1>
        <p className={ui.muted}>{stored.title}</p>
      </div>
      <fieldset disabled={!canEdit} className="space-y-6">
        {children({ draft, setDraft, canEdit })}
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
            onDiscard?.();
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
