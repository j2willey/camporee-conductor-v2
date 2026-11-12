import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useDeferredValue, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { client, data } from "../api.ts";
import { ui } from "../ui.ts";
import { useDownload } from "../useDownload.ts";
import { useOpenHtmlInNewTab } from "../useOpenHtmlInNewTab.ts";
import { ErrorMessage, Loading, PageError } from "./ErrorMessage.tsx";

type Kind = "" | "template" | "activity";

type Item = InferResponseType<typeof client.api.library.$get, 200>[number];

const KINDS: { value: Kind; label: string }[] = [
  { value: "", label: "Everything" },
  { value: "template", label: "Templates" },
  { value: "activity", label: "Activities" },
];

/** What a row can do besides Preview: add to the Event being filled, publish, unpublish (#102 PR 3). */
type RowActions = {
  /** "Add to Patrol Games", when the page was opened from an Event's Competition. */
  add?: { label: string; run: () => void };
  publish?: () => void;
  unpublish?: () => void;
  /** A Template's New Event form: the Organizations the caller can make Events in (#102 PR 4). */
  newEventIn?: { id: string; name: string }[];
  busy: boolean;
};

/**
 * The library catalog (ADR-0031, #102 PR 2): the library plus your Organizations' private Templates and saved
 * Activities, filtered by kind, tag and text, each with a preview. Opened from an Event's Competition
 * (`?addTo=<eventId>&competition=<id>`), each Activity can be added to it as a copy (#102 PR 3). Curators publish
 * their Organizations' private documents and unpublish library ones.
 */
export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const addTo = params.get("addTo") ?? "";
  const competitionId = params.get("competition") ?? "";
  const [kind, setKind] = useState<Kind>(addTo ? "activity" : "");
  const [text, setText] = useState("");
  const [tag, setTag] = useState("");
  const q = useDeferredValue(text.trim());
  const kindQuery = kind === "" ? {} : { kind };

  const items = useQuery({
    queryKey: ["library", kind, q, tag],
    queryFn: () =>
      data(
        client.api.library.$get({
          query: {
            ...kindQuery,
            ...(q !== "" && { q }),
            ...(tag !== "" && { tag }),
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });
  // The tags to pick from: every tag of this kind, whatever the other filters.
  const tags = useQuery({
    queryKey: ["library", kind, "", ""],
    queryFn: () => data(client.api.library.$get({ query: kindQuery })),
    select: (all) =>
      [...new Set(all.flatMap((item) => item.tags))].sort((a, b) =>
        a.localeCompare(b, "en", { sensitivity: "base" }),
      ),
  });

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => data(client.api.me.$get()),
  });
  const target = useQuery({
    queryKey: ["events", addTo],
    queryFn: () =>
      data(client.api.events[":eventId"].$get({ param: { eventId: addTo } })),
    enabled: addTo !== "",
  });
  const competition = target.data?.event.competitions.find(
    (c) => c.id === competitionId,
  );

  const add = useMutation({
    mutationFn: (activityId: string) =>
      data(
        client.api.events[":eventId"].activities["from-library"].$post(
          { param: { eventId: addTo }, json: { competitionId, activityId } },
          { headers: { "if-match": String(target.data?.updatedAt ?? "") } },
        ),
      ),
    onSuccess: ({ activityId }) =>
      queryClient
        .invalidateQueries({ queryKey: ["events", addTo] })
        .then(() => navigate(`/events/${addTo}/activities/${activityId}`)),
    // A stale Event (someone else changed it) is read again, so the next try can succeed.
    onError: () =>
      queryClient.invalidateQueries({ queryKey: ["events", addTo] }),
  });
  const curate = useMutation({
    mutationFn: ({
      id,
      to,
    }: {
      id: string;
      to: "publish" | "unpublish";
    }): Promise<unknown> =>
      to === "publish"
        ? data(client.api.library.publish.$post({ json: { id } }))
        : data(client.api.library.unpublish.$post({ json: { id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library"] }),
  });
  const busy = add.isPending || curate.isPending;
  const editorOf = new Set(
    (me.data?.organizations ?? [])
      .filter((o) => o.role === "owner" || o.role === "editor")
      .map((o) => o.id),
  );
  const actionsFor = (item: Item): RowActions => {
    const actions: RowActions = { busy };
    if (competition && target.data && item.kind === "activity") {
      actions.add = {
        label: `Add to ${competition.label}`,
        run: () => add.mutate(item.id),
      };
    }
    if (me.data?.curator) {
      // Publishing also needs an editor of the document's Organization (ADR-0031 item 3, #102 PR 1).
      if (item.visibility === "private" && editorOf.has(item.organization.id)) {
        actions.publish = () => curate.mutate({ id: item.id, to: "publish" });
      }
      if (item.visibility === "library") {
        actions.unpublish = () =>
          curate.mutate({ id: item.id, to: "unpublish" });
      }
    }
    if (item.kind === "template") {
      actions.newEventIn = (me.data?.organizations ?? []).filter((o) =>
        editorOf.has(o.id),
      );
    }
    return actions;
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className={ui.h1}>Library</h1>
        <p className="text-stone-600">
          Templates and Activities to start from: the shared library, and the
          ones your Organizations keep for themselves.
        </p>
      </div>

      {addTo !== "" &&
        (target.isPending ? (
          <Loading />
        ) : target.isError ? (
          <PageError error={target.error} />
        ) : (
          <div className={`${ui.card} space-y-3 border-teal-200 bg-teal-50/40`}>
            <p>
              <Link to={`/events/${addTo}`} className={ui.link}>
                ← Back to {target.data.event.title}
              </Link>
            </p>
            <label className={ui.label}>
              Adding an Activity to
              <select
                value={competition ? competitionId : ""}
                onChange={(e) =>
                  setParams({ addTo, competition: e.target.value })
                }
                className={ui.input}
              >
                <option value="" disabled>
                  Pick a Competition
                </option>
                {target.data.event.competitions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <p className={ui.muted}>
              The Activity is copied into {target.data.event.title}. Later
              changes to the original don't reach the copy.
            </p>
          </div>
        ))}

      {(add.error ?? curate.error) && (
        <ErrorMessage error={(add.error ?? curate.error) as Error} />
      )}

      <div className={`${ui.card} flex flex-wrap items-end gap-3`}>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium text-stone-700">Show</legend>
          <div className="flex flex-wrap gap-1">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                aria-pressed={kind === k.value}
                onClick={() => {
                  setKind(k.value);
                  setTag("");
                }}
                className={
                  kind === k.value
                    ? "rounded-md bg-teal-700 px-3 py-1 text-sm text-white"
                    : ui.buttonQuiet
                }
              >
                {k.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label className={`${ui.label} min-w-40 flex-1`}>
          Search
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Title or tag"
            className={ui.input}
          />
        </label>
        <label className={ui.label}>
          Tag
          <select
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            className={ui.input}
          >
            <option value="">Any tag</option>
            {(tags.data ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      {items.isPending ? (
        <Loading />
      ) : items.isError ? (
        <PageError error={items.error} />
      ) : items.data.length === 0 ? (
        <p className="text-stone-600">
          {kind === "" && q === "" && tag === ""
            ? "Nothing here yet. Templates and saved Activities will show up here."
            : "Nothing matches these filters."}
        </p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {items.data.map((item) => (
            <CatalogRow key={item.id} item={item} actions={actionsFor(item)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CatalogRow({ item, actions }: { item: Item; actions: RowActions }) {
  const preview = useOpenHtmlInNewTab(
    () => client.api.library[":id"].preview.$get({ param: { id: item.id } }),
    "Couldn't load the preview.",
  );
  const detail =
    item.kind === "template"
      ? `Template · ${item.activityCount ?? 0} ${item.activityCount === 1 ? "Activity" : "Activities"}`
      : `Activity · ${item.scoringType === "exhibition" ? "exhibition" : "ranked"}`;
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h2 className="font-medium break-words">{item.title}</h2>
          <p className={ui.muted}>
            {detail} · {item.organization.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              item.visibility === "library"
                ? "rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-900"
                : "rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-700"
            }
          >
            {item.visibility === "library" ? "Library" : "Private"}
          </span>
          <button
            type="button"
            onClick={() => void preview.open()}
            disabled={preview.opening}
            aria-label={`Preview ${item.title}`}
            className={ui.buttonQuiet}
          >
            Preview
          </button>
          {/* One editor (ADR-0031 item 6, #102 PR 5): read-only unless it's yours to change. */}
          <Link
            to={
              item.kind === "template"
                ? `/events/${item.id}`
                : `/activities/${item.id}`
            }
            aria-label={`Open ${item.title}`}
            className={ui.buttonQuiet}
          >
            Open
          </Link>
          {actions.publish && (
            <button
              type="button"
              onClick={actions.publish}
              disabled={actions.busy}
              aria-label={`Publish ${item.title}`}
              className={ui.buttonQuiet}
            >
              Publish
            </button>
          )}
          {actions.unpublish && (
            <button
              type="button"
              onClick={actions.unpublish}
              disabled={actions.busy}
              aria-label={`Unpublish ${item.title}`}
              className={ui.buttonQuiet}
            >
              Unpublish
            </button>
          )}
          {actions.add && (
            <button
              type="button"
              onClick={actions.add.run}
              disabled={actions.busy}
              aria-label={`${actions.add.label}: ${item.title}`}
              className={ui.button}
            >
              {actions.add.label}
            </button>
          )}
        </div>
      </div>
      {item.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Tags">
          {item.tags.map((t) => (
            <li
              key={t}
              className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600"
            >
              {t}
            </li>
          ))}
        </ul>
      )}
      {item.kind === "template" && (
        <TemplateActions
          templateId={item.id}
          title={item.title}
          organizations={actions.newEventIn ?? []}
        />
      )}
      {preview.error && <ErrorMessage error={new Error(preview.error)} />}
    </li>
  );
}

/**
 * A Template's own actions (#102 PR 4): New Event (a copy in one of your Organizations, then it opens) and the
 * Template's zip.
 */
function TemplateActions({
  templateId,
  title,
  organizations,
}: {
  templateId: string;
  title: string;
  organizations: { id: string; name: string }[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState("");
  // The first of your Organizations until you pick one: they may load after this row first renders.
  const organizationId = picked || (organizations[0]?.id ?? "");
  const [eventTitle, setEventTitle] = useState("");
  const create = useMutation({
    mutationFn: () =>
      data(
        client.api.templates[":templateId"]["new-event"].$post({
          param: { templateId },
          json: {
            organizationId,
            ...(eventTitle.trim() !== "" && { title: eventTitle.trim() }),
          },
        }),
      ),
    onSuccess: async ({ eventId }) => {
      await queryClient.invalidateQueries({
        queryKey: ["organizations", organizationId, "events"],
      });
      void navigate(`/events/${eventId}`);
    },
  });
  const zip = useDownload(
    () =>
      client.api.templates[":templateId"].cartridge.$get({
        param: { templateId },
      }),
    "template.zip",
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {organizations.length > 0 && (
          <button
            type="button"
            className={ui.buttonQuiet}
            aria-expanded={open}
            aria-label={`New Event from ${title}`}
            onClick={() => setOpen(!open)}
          >
            New Event…
          </button>
        )}
        <button
          type="button"
          className={ui.buttonQuiet}
          aria-label={`Download ${title} as a zip`}
          disabled={zip.downloading}
          onClick={() => void zip.download()}
        >
          Download zip
        </button>
        {zip.error && (
          <span role="alert" className={ui.error}>
            {zip.error}
          </span>
        )}
      </div>
      {open && (
        <form
          onSubmit={submit}
          className="flex flex-wrap items-end gap-3 rounded-md bg-stone-50 p-3"
          aria-label={`New Event from ${title}`}
        >
          <label className={ui.label}>
            Organization
            <select
              value={organizationId}
              onChange={(e) => setPicked(e.target.value)}
              className={ui.input}
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className={`${ui.label} min-w-40 flex-1`}>
            Title
            <input
              value={eventTitle}
              onChange={(e) => setEventTitle(e.target.value)}
              placeholder={title}
              className={ui.input}
            />
          </label>
          <button
            type="submit"
            disabled={create.isPending || organizationId === ""}
            className={ui.button}
          >
            {create.isPending ? "Creating…" : "Create Event"}
          </button>
          {create.isError && <ErrorMessage error={create.error} />}
        </form>
      )}
    </div>
  );
}
