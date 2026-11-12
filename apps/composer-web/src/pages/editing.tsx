import { useEffect, type ReactNode } from "react";
import { useBlocker } from "react-router";
import { ApiError } from "../api.ts";
import { moveItem, removeItem, replaceItem } from "../draft.ts";
import { ui } from "../ui.ts";

// Pieces shared by the Composer's editing pages (ADR-0029): the Save bar, the leave warning, and form parts.

/** Warns before leaving with unsaved changes: another page in the app, or closing or reloading the tab. */
export function useLeaveWarning(when: boolean) {
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

export function SaveBar({
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

export function Card({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={`${ui.card} space-y-4`} aria-label={title}>
      <h2 className={ui.h2}>{title}</h2>
      {children}
    </section>
  );
}

export function Text({
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

export function Area({
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
export function RowButtons({
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

export function StringList({
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

/**
 * Says whose a library document or Template is to change (ADR-0031 item 6, #102 PR 5): a library one is the
 * curators', and a change reaches everyone who uses the library from then on, though never copies already made.
 */
export function LibraryNote({
  what,
  visibility,
  canEdit,
}: {
  what: "Template" | "Activity";
  visibility: "private" | "library";
  canEdit: boolean;
}) {
  if (visibility === "private") {
    return (
      <p className={ui.muted}>
        {what} · Private to your Organization. A curator can publish it from the
        Library.
      </p>
    );
  }
  return (
    <p className="rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-900">
      {what} · In the library.{" "}
      {canEdit
        ? "Your changes reach everyone who uses it from now on; copies already made don't change."
        : "Only a curator can change it. Use it from the Library to make your own copy."}
    </p>
  );
}
