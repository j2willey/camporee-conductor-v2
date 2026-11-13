import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useDeferredValue, useState } from "react";
import { Link } from "react-router";
import { client, data } from "../api.ts";
import { ui } from "../ui.ts";
import { ErrorMessage, Loading, PageError } from "./ErrorMessage.tsx";

type AdminUser = InferResponseType<
  typeof client.api.admin.users.$get,
  200
>["users"][number];
type Flag = "curator" | "sysadmin" | "suspended";

const FLAGS: {
  flag: Flag;
  label: string;
  confirm?: (on: boolean) => string;
}[] = [
  { flag: "curator", label: "Curator" },
  {
    flag: "sysadmin",
    label: "Sysadmin",
    confirm: (on) =>
      on
        ? "Make this user a sysadmin? For the rollout, a sysadmin can open and change every Organization's Events."
        : "Remove this user's sysadmin flag?",
  },
  {
    flag: "suspended",
    label: "Suspended",
    confirm: (on) =>
      on
        ? "Suspend this user? They'll be refused everywhere until unsuspended; nothing of theirs is deleted."
        : "Unsuspend this user?",
  },
];

const when = (ms: number | null) =>
  ms === null ? "never" : new Date(ms).toLocaleString();

/**
 * The users list (ADR-0032, #104 PR 1; v1's sysadmin page): search by email, each user's Organizations, and their
 * curator, sysadmin and suspended flags. Sysadmins only: anyone else gets a whole-page Not found.
 */
export function AdminPage() {
  const [text, setText] = useState("");
  const q = useDeferredValue(text.trim());
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => data(client.api.me.$get()),
  });
  const list = useQuery({
    queryKey: ["admin", "users", q],
    queryFn: () => data(client.api.admin.users.$get({ query: q ? { q } : {} })),
    placeholderData: keepPreviousData,
  });
  const change = useMutation({
    mutationFn: ({
      user,
      flag,
      on,
    }: {
      user: AdminUser;
      flag: Flag;
      on: boolean;
    }) =>
      data(
        client.api.admin.users[":userId"].$patch({
          param: { userId: user.id },
          json: { [flag]: on },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      return queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  if (list.isPending) return <Loading />;
  if (list.isError) return <PageError error={list.error} />;
  const myId = me.data?.id;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className={ui.h1}>Users</h1>
        <p className="text-stone-600">
          Everyone who has signed in. {list.data.total}{" "}
          {list.data.total === 1 ? "user" : "users"}
          {q ? " match" : ""}
          {list.data.total > list.data.users.length &&
            `; showing the ${list.data.users.length} seen most recently`}
          .
        </p>
      </div>
      <label className={`${ui.label} max-w-md`}>
        Search
        <input
          type="search"
          className={ui.input}
          value={text}
          placeholder="Email"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {change.error && <ErrorMessage error={change.error} />}
      <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
        {list.data.users.map((user) => (
          <li key={user.id} className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                <h2 className="font-medium break-all">
                  {user.email}
                  {user.id === myId && (
                    <span className={`${ui.muted} font-normal`}> (you)</span>
                  )}
                </h2>
                <p className={ui.muted}>
                  Joined {when(user.createdAt)} · last seen{" "}
                  {when(user.lastSeenAt)}
                </p>
              </div>
              <fieldset
                className="flex flex-wrap gap-3"
                aria-label={`Flags for ${user.email}`}
              >
                {FLAGS.map(({ flag, label, confirm }) => {
                  // A sysadmin can't remove their own flag or suspend themself (ADR-0032 item 5).
                  const locked =
                    user.id === myId &&
                    (flag === "sysadmin" || flag === "suspended");
                  return (
                    <label
                      key={flag}
                      className="flex items-center gap-1.5 text-sm text-stone-700"
                    >
                      <input
                        type="checkbox"
                        checked={user[flag]}
                        disabled={locked || change.isPending}
                        aria-label={`${label}: ${user.email}`}
                        onChange={(e) => {
                          const on = e.target.checked;
                          if (confirm && !window.confirm(confirm(on))) return;
                          change.mutate({ user, flag, on });
                        }}
                      />
                      {label}
                    </label>
                  );
                })}
              </fieldset>
            </div>
            {user.organizations.length > 0 ? (
              <ul
                className="flex flex-wrap gap-2 text-sm"
                aria-label="Organizations"
              >
                {user.organizations.map((org) => (
                  <li key={org.id}>
                    <Link to={`/organizations/${org.id}`} className={ui.link}>
                      {org.name}
                    </Link>{" "}
                    <span className={ui.muted}>({org.role})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={ui.muted}>No Organizations.</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
