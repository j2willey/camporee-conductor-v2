import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { client, data } from "../api.ts";
import { ui } from "../ui.ts";
import { Loading, PageError } from "./ErrorMessage.tsx";

/**
 * The audit log (ADR-0032 notes, #104 PR 3): newest first, 50 at a time, filtered by a user's email and by action.
 * The filters live in the URL, so the users list can link to one user's rows. Sysadmins only: anyone else gets a
 * whole-page Not found.
 */
export function AdminAuditPage() {
  const [params, setParams] = useSearchParams();
  const user = params.get("user") ?? "";
  const action = params.get("action") ?? "";
  const [text, setText] = useState(user);

  const filter = (next: { user?: string; action?: string }) => {
    const merged = { user, action, ...next };
    setParams(
      Object.fromEntries(
        Object.entries(merged).filter(([, value]) => value.trim() !== ""),
      ),
    );
  };

  const log = useInfiniteQuery({
    queryKey: ["admin", "audit", user, action],
    queryFn: ({ pageParam }) =>
      data(
        client.api.admin.audit.$get({
          query: {
            ...(user && { user }),
            ...(action && { action }),
            ...(pageParam !== null && { before: pageParam }),
          },
        }),
      ),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next,
  });

  if (log.isPending) return <Loading />;
  if (log.isError) return <PageError error={log.error} />;
  const entries = log.data.pages.flatMap((page) => page.entries);
  const actions = log.data.pages[0]?.actions ?? [];

  return (
    <div className="space-y-6">
      <p>
        <Link to="/admin" className={ui.link}>
          ← Users
        </Link>
      </p>
      <h1 className={ui.h1}>Audit log</h1>
      <div className="flex flex-wrap items-end gap-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            filter({ user: text.trim() });
          }}
        >
          <label className={ui.label}>
            User's email
            <input
              type="search"
              className={ui.input}
              value={text}
              placeholder="Everyone"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button type="submit" className={ui.buttonQuiet}>
            Filter
          </button>
        </form>
        <label className={ui.label}>
          Action
          <select
            className={ui.input}
            value={action}
            onChange={(e) => filter({ action: e.target.value })}
          >
            <option value="">All actions</option>
            {/* Keeps a filtered action listed even before it's in the log. */}
            {[...new Set([...actions, ...(action ? [action] : [])])].map(
              (name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      {entries.length === 0 ? (
        <p className={ui.muted}>Nothing in the log matches.</p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {entries.map((entry) => (
            <li key={entry.id} className="space-y-0.5 px-4 py-2 text-sm">
              <p className="flex flex-wrap gap-x-2">
                <span className="font-mono font-medium">{entry.action}</span>
                <span className="break-all text-stone-700">
                  {entry.userEmail ?? "(command line)"}
                </span>
                {entry.organization && (
                  <Link
                    to={`/organizations/${entry.organization.id}`}
                    className={ui.link}
                  >
                    {entry.organization.name}
                  </Link>
                )}
              </p>
              <p className={ui.muted}>
                {new Date(entry.at).toLocaleString()}
                {entry.documentKind &&
                  ` · ${entry.documentKind}: ${entry.documentTitle ?? "(deleted)"}`}
              </p>
              {entry.detail !== null && (
                <p className="font-mono text-xs break-all text-stone-500">
                  {JSON.stringify(entry.detail)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {log.hasNextPage && (
        <button
          type="button"
          className={ui.buttonQuiet}
          disabled={log.isFetchingNextPage}
          onClick={() => void log.fetchNextPage()}
        >
          {log.isFetchingNextPage ? "Loading…" : "Older"}
        </button>
      )}
    </div>
  );
}
