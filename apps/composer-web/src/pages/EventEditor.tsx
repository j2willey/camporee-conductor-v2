import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EventSchema,
  TemplateSchema,
  type Event,
} from "@camporee-conductor/schema";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { client, data } from "../api.ts";
import { ui } from "../ui.ts";
import type { EventRead } from "./ActivityList.tsx";
import { LibraryNote, SaveBar, useLeaveWarning } from "./editing.tsx";
import { Loading, PageError } from "./ErrorMessage.tsx";

type Heading = string | { event: string; template: string };

/** What a page that edits part of the Event gets: the draft, a way to change it, and whether it can. */
export interface EventPane {
  draft: Event;
  setDraft: (event: Event) => void;
  canEdit: boolean;
  /** A Template opens in the same editor (ADR-0031 item 6): it has no contacts. */
  isTemplate: boolean;
  /** The Event as stored and its `updatedAt`, for a change saved on its own (an AI proposal, ADR-0030). */
  stored: Event;
  updatedAt: number;
  dirty: boolean;
}

/**
 * A page that edits the Event (ADR-0029): loads it, keeps a draft, and saves it whole with If-Match, with the
 * Save bar and the leave warning. `children` draws the page's own part of the Event. Used by the Competitions
 * and Awards page (#6 PR 6) and Event details (#6 PR 7). A Template is edited here too, checked with the Template
 * rules (#102 PR 5).
 */
export function EventEditorPage({
  heading,
  children,
  onDiscard,
}: {
  /** One heading, or one for an Event and one for a Template. */
  heading: Heading;
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
  heading: Heading;
  children: (pane: EventPane) => ReactNode;
  onDiscard: (() => void) | undefined;
}) {
  const stored = read.event as Event;
  const canEdit = read.role === "owner" || read.role === "editor";
  const isTemplate = read.kind === "template";
  const [draft, setDraft] = useState<Event>(stored);
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);
  const check = (isTemplate ? TemplateSchema : EventSchema).safeParse(draft);
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
            ← Back to the {isTemplate ? "Template" : "Event"}
          </Link>
        </p>
        <h1 className={ui.h1}>
          {typeof heading === "string"
            ? heading
            : isTemplate
              ? heading.template
              : heading.event}
        </h1>
        <p className={ui.muted}>{stored.title}</p>
        {isTemplate && (
          <LibraryNote
            what="Template"
            visibility={read.visibility}
            canEdit={canEdit}
          />
        )}
      </div>
      <fieldset disabled={!canEdit} className="space-y-6">
        {children({
          draft,
          setDraft,
          canEdit,
          isTemplate,
          stored,
          updatedAt: read.updatedAt,
          dirty,
        })}
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
