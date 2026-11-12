import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OfficialSchema, type Official } from "@camporee-conductor/schema";
import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { client, data } from "../api.ts";
import { moveItem, omit, removeItem, replaceItem } from "../draft.ts";
import { ui } from "../ui.ts";
import { RowButtons, SaveBar, useLeaveWarning } from "./editing.tsx";
import { Loading, PageError } from "./ErrorMessage.tsx";

type OfficialsRead = InferResponseType<
  (typeof client.api.events)[":eventId"]["officials"]["$get"],
  200
>;

const officialsKey = (eventId: string) => ["events", eventId, "officials"];

/**
 * The Event's Officials (ADR-0027 item 5, #100 PR 4): who signs in on the box's Official view, by email only.
 * No accounts (ADR-0023). Editors and owners only, since these are emails; they go only into the event-day
 * cartridge, which needs at least one Director.
 */
export function OfficialsPage() {
  const { eventId = "" } = useParams();
  const result = useQuery({
    queryKey: officialsKey(eventId),
    queryFn: () =>
      data(
        client.api.events[":eventId"].officials.$get({ param: { eventId } }),
      ),
    // A background refetch would replace the draft; the page reloads only when asked.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  if (result.isPending) return <Loading />;
  if (result.isError) return <PageError error={result.error} />;
  return (
    <Editor
      key={result.data.updatedAt ?? "new"}
      eventId={eventId}
      read={result.data}
    />
  );
}

function Editor({ eventId, read }: { eventId: string; read: OfficialsRead }) {
  const stored: Official[] = read.officials?.officials ?? [];
  const [draft, setDraft] = useState<Official[]>(stored);
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);
  const issues = draft.flatMap((official, i) => {
    const check = OfficialSchema.safeParse(official);
    return check.success
      ? []
      : check.error.issues.map(
          (issue) =>
            `Official ${i + 1}${issue.path.length > 0 ? ` ${issue.path.map(String).join(".")}` : ""}: ${issue.message}`,
        );
  });
  const emails = draft.map((o) => o.email.trim().toLowerCase());
  emails.forEach((email, i) => {
    if (email && emails.indexOf(email) !== i) {
      issues.push(`Official ${i + 1}: ${email} is listed twice`);
    }
  });
  const hasDirector = draft.some((o) => o.role === "director");

  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => {
      const officials = draft.map((o) => ({ ...o, email: o.email.trim() }));
      return read.officials
        ? data(
            client.api.officials[":officialsId"].$put(
              {
                param: { officialsId: read.officials.id },
                json: { ...read.officials, officials },
              },
              { headers: { "if-match": String(read.updatedAt) } },
            ),
          )
        : data(
            client.api.events[":eventId"].officials.$post({
              param: { eventId },
              json: { officials },
            }),
          );
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: officialsKey(eventId) }),
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
        <h1 className={ui.h1}>Officials</h1>
        <p className={ui.muted}>
          Officials sign in on the box's Official view with their email. There
          are no accounts or passwords. A Director can also add Officials on
          site. These emails go only into the event-day cartridge.
        </p>
      </div>
      <section className={`${ui.card} space-y-3`} aria-label="Officials">
        {draft.length === 0 && <p className={ui.muted}>No Officials yet.</p>}
        <ol className="space-y-2">
          {draft.map((official, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <label className={`${ui.label} min-w-56 flex-1`}>
                Email
                <input
                  type="email"
                  className={ui.input}
                  aria-label={`Email of Official ${i + 1}`}
                  value={official.email}
                  onChange={(e) =>
                    setDraft(
                      replaceItem(draft, i, {
                        ...official,
                        email: e.target.value,
                      }),
                    )
                  }
                />
              </label>
              <label className={`${ui.label} min-w-40 flex-1`}>
                Name (optional)
                <input
                  className={ui.input}
                  aria-label={`Name of Official ${i + 1}`}
                  value={official.name ?? ""}
                  onChange={(e) =>
                    setDraft(
                      replaceItem(
                        draft,
                        i,
                        e.target.value === ""
                          ? omit(official, "name")
                          : { ...official, name: e.target.value },
                      ),
                    )
                  }
                />
              </label>
              <label className="flex items-center gap-1 pb-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  aria-label={`Official ${i + 1} is a Director`}
                  checked={official.role === "director"}
                  onChange={(e) =>
                    setDraft(
                      replaceItem(draft, i, {
                        ...official,
                        role: e.target.checked ? "director" : "official",
                      }),
                    )
                  }
                />
                Director
              </label>
              <span className="pb-2">
                <RowButtons
                  name={`Official ${i + 1}`}
                  index={i}
                  count={draft.length}
                  onMove={(step) => setDraft(moveItem(draft, i, step))}
                  onRemove={() => setDraft(removeItem(draft, i))}
                />
              </span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className={ui.buttonQuiet}
          onClick={() =>
            setDraft([
              ...draft,
              {
                email: "",
                role: draft.length === 0 ? "director" : "official",
              },
            ])
          }
        >
          + Add Official
        </button>
        {!hasDirector && (
          <p role="note" className="text-sm text-amber-800">
            No Director yet. The event-day cartridge needs at least one.
          </p>
        )}
      </section>
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
          void queryClient.invalidateQueries({
            queryKey: officialsKey(eventId),
          });
        }}
      />
    </div>
  );
}
