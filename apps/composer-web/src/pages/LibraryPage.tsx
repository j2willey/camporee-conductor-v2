import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useDeferredValue, useState } from "react";
import { client, data } from "../api.ts";
import { ui } from "../ui.ts";
import { useOpenHtmlInNewTab } from "../useOpenHtmlInNewTab.ts";
import { ErrorMessage, Loading, PageError } from "./ErrorMessage.tsx";

type Kind = "" | "template" | "activity";

type Item = InferResponseType<typeof client.api.library.$get, 200>[number];

const KINDS: { value: Kind; label: string }[] = [
  { value: "", label: "Everything" },
  { value: "template", label: "Templates" },
  { value: "activity", label: "Activities" },
];

/**
 * The library catalog (ADR-0031, #102 PR 2): the library plus your Organizations' private Templates and saved
 * Activities, filtered by kind, tag and text, each with a preview.
 */
export function LibraryPage() {
  const [kind, setKind] = useState<Kind>("");
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

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className={ui.h1}>Library</h1>
        <p className="text-stone-600">
          Templates and Activities to start from: the shared library, and the
          ones your Organizations keep for themselves.
        </p>
      </div>

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
            <CatalogRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CatalogRow({ item }: { item: Item }) {
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
        <div className="flex items-center gap-2">
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
      {preview.error && <ErrorMessage error={new Error(preview.error)} />}
    </li>
  );
}
