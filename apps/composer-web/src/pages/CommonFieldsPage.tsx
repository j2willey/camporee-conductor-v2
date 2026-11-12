import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CommonFieldSetSchema,
  type CommonFieldSet,
  type Event,
} from "@camporee-conductor/schema";
import { fillVariables } from "@camporee-conductor/scoring";
import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { client, data } from "../api.ts";
import { inUseMissing, placementOf, variablesUsed } from "../common-fields.ts";
import { addField, sorted, type Field } from "../scoring-fields.ts";
import { ui } from "../ui.ts";
import type { EventRead } from "./ActivityList.tsx";
import { SaveBar, useLeaveWarning } from "./editing.tsx";
import { Loading, PageError } from "./ErrorMessage.tsx";
import { FieldList } from "./ScoringEditor.tsx";

type CommonRead = InferResponseType<
  (typeof client.api.events)[":eventId"]["common-fields"]["$get"],
  200
>;

const commonKey = (eventId: string) => ["events", eventId, "common-fields"];

/**
 * The Event's Common Fields (ADR-0020, #99 PR 2): one set, defined once and applied by each Competition before or
 * after every Activity's own fields at runtime, never copied in. Edit the set's fields and save it whole with
 * If-Match (ADR-0029); see `{{variable}}` labels filled from one Activity. Each Competition picks its fields on the
 * Competitions page.
 */
export function CommonFieldsPage() {
  const { eventId = "" } = useParams();
  const eventRead = useQuery({
    queryKey: ["events", eventId],
    queryFn: () =>
      data(client.api.events[":eventId"].$get({ param: { eventId } })),
  });
  const common = useQuery({
    queryKey: commonKey(eventId),
    queryFn: () =>
      data(
        client.api.events[":eventId"]["common-fields"].$get({
          param: { eventId },
        }),
      ),
    // A background refetch would replace the draft; the page reloads only when asked.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  if (eventRead.isPending || common.isPending) return <Loading />;
  if (eventRead.isError) return <PageError error={eventRead.error} />;
  if (common.isError) return <PageError error={common.error} />;
  const event = eventRead.data.event as Event;
  const canEdit = common.data.role === "owner" || common.data.role === "editor";

  return (
    <div className="space-y-6 pb-24">
      <div className="space-y-1">
        <p>
          <Link to={`/events/${eventId}`} className={ui.link}>
            ← Back to the Event
          </Link>
        </p>
        <h1 className={ui.h1}>Common Fields</h1>
        <p className={ui.muted}>
          {event.title} · Fields every Activity in a Competition shows, such as
          a flag or spirit score. They're defined once here, and each
          Competition picks which ones go before and after its Activities' own
          fields on the{" "}
          <Link to={`/events/${eventId}/competitions`} className={ui.link}>
            Competitions page
          </Link>
          .
        </p>
      </div>
      {common.data.set === null ? (
        <StartCommonFields
          eventId={eventId}
          read={eventRead.data}
          canEdit={canEdit}
        />
      ) : (
        <Editor
          key={common.data.updatedAt}
          eventId={eventId}
          eventRead={eventRead.data}
          read={common.data}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}

function StartCommonFields({
  eventId,
  read,
  canEdit,
}: {
  eventId: string;
  read: EventRead;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: () =>
      data(
        client.api.events[":eventId"]["common-fields"].$post(
          { param: { eventId }, json: { fields: addField([]) } },
          { headers: { "if-match": String(read.updatedAt) } },
        ),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["events", eventId] }),
  });
  return (
    <section className={`${ui.card} space-y-3`}>
      <p>This Event has no Common Fields yet.</p>
      {canEdit && (
        <button
          type="button"
          className={ui.button}
          disabled={start.isPending}
          onClick={() => start.mutate()}
        >
          Start Common Fields
        </button>
      )}
      {start.error && (
        <p role="alert" className={ui.error}>
          {start.error.message}
        </p>
      )}
    </section>
  );
}

function Editor({
  eventId,
  eventRead,
  read,
  canEdit,
}: {
  eventId: string;
  eventRead: EventRead;
  read: CommonRead;
  canEdit: boolean;
}) {
  const stored = read.set as CommonFieldSet;
  const event = eventRead.event as Event;
  const [draft, setDraft] = useState<CommonFieldSet>(stored);
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);
  const check = CommonFieldSetSchema.safeParse(draft);
  const issues = [
    ...(check.success
      ? []
      : check.error.issues.map(
          (i) =>
            `${i.path.length > 0 ? `${i.path.map(String).join(".")}: ` : ""}${i.message}`,
        )),
    ...inUseMissing(
      event,
      draft.fields.map((f) => f.id),
    ),
  ];

  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      data(
        client.api["common-field-sets"][":setId"].$put(
          { param: { setId: stored.id }, json: draft },
          { headers: { "if-match": String(read.updatedAt) } },
        ),
      ),
    onSuccess: ({ updatedAt }) => {
      queryClient.setQueryData<CommonRead>(commonKey(eventId), {
        ...read,
        set: draft as CommonRead["set"],
        updatedAt,
      });
      // The scoring preview on each Activity page reads the sets too.
      return queryClient.invalidateQueries({
        queryKey: ["events", eventId, "common-field-sets"],
      });
    },
  });
  useLeaveWarning(dirty && !save.isPending);
  const fields = sorted(draft.fields);

  return (
    <>
      <fieldset disabled={!canEdit} className="space-y-6">
        <section className={`${ui.card} space-y-4`} aria-label="Fields">
          <h2 className={ui.h2}>Fields</h2>
          <p className={ui.muted}>
            A label or placeholder may use a variable, such as{" "}
            <code>{"{{ten_essentials}}"}</code>: each Activity fills it in from
            its own variables. A Common Field can't be the primary metric.
          </p>
          <UsedBy event={event} fields={fields} />
          <FieldList
            fields={fields}
            onChange={(next: Field[]) => setDraft({ ...draft, fields: next })}
            allowPrimary={false}
          />
        </section>
      </fieldset>
      <VariablesPreview eventRead={eventRead} fields={fields} />
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
            void queryClient.invalidateQueries({
              queryKey: commonKey(eventId),
            });
          }}
        />
      )}
    </>
  );
}

/** Which Competitions use each field, and where. */
function UsedBy({ event, fields }: { event: Event; fields: Field[] }) {
  const rows = event.competitions.map((c) => {
    const where = (place: "before" | "after") =>
      fields.filter((f) => placementOf(c, f.id) === place).map((f) => f.label);
    return { label: c.label, before: where("before"), after: where("after") };
  });
  return (
    <ul className="space-y-1 text-sm text-stone-700" aria-label="Used by">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="font-medium">{r.label}:</span>{" "}
          {r.before.length + r.after.length === 0
            ? "none."
            : [
                r.before.length > 0 && `before: ${r.before.join(", ")}`,
                r.after.length > 0 && `after: ${r.after.join(", ")}`,
              ]
                .filter(Boolean)
                .join("; ") + "."}
        </li>
      ))}
    </ul>
  );
}

/** The fields' labels and placeholders as one Activity's Judges see them, with its variables filled in. */
function VariablesPreview({
  eventRead,
  fields,
}: {
  eventRead: EventRead;
  fields: Field[];
}) {
  const used = variablesUsed(fields);
  const [activityId, setActivityId] = useState("");
  const activity = useQuery({
    queryKey: ["activities", activityId],
    queryFn: () =>
      data(
        client.api.activities[":activityId"].$get({ param: { activityId } }),
      ),
    enabled: activityId !== "",
  });
  if (used.length === 0) return null;
  const variables = activity.data?.activity.variables ?? {};
  const missing = used.filter((key) => !Object.hasOwn(variables, key));
  const titles = [...eventRead.activities].sort((a, b) =>
    a.title.localeCompare(b.title),
  );
  return (
    <section className={`${ui.card} space-y-3`} aria-label="Variables">
      <h2 className={ui.h2}>Variables</h2>
      <p className={ui.muted}>
        Used here: {used.map((k) => `{{${k}}}`).join(", ")}. Pick an Activity to
        see its Judges' labels.
      </p>
      <label className={`${ui.label} max-w-md`}>
        Activity
        <select
          className={ui.input}
          value={activityId}
          onChange={(e) => setActivityId(e.target.value)}
        >
          <option value="">Choose…</option>
          {titles.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </label>
      {activity.isError && <p className={ui.error}>{activity.error.message}</p>}
      {activity.data && (
        <>
          <ul className="list-disc space-y-1 pl-6 text-sm">
            {fillVariables(fields, variables).map((f) => (
              <li key={f.id}>
                {f.label}
                {f.config?.placeholder && (
                  <span className="text-stone-500">
                    {" "}
                    ({f.config.placeholder})
                  </span>
                )}
              </li>
            ))}
          </ul>
          {missing.length > 0 && (
            <p className={ui.muted}>
              This Activity doesn't set{" "}
              {missing.map((k) => `{{${k}}}`).join(", ")}: set it in the
              Activity's Variables, or Judges see the braces as they are.
            </p>
          )}
        </>
      )}
    </section>
  );
}
