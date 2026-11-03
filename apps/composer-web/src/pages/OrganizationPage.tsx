import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { client, data } from "../api.ts";
import { ui } from "../ui.ts";
import { ErrorMessage, Loading, PageError } from "./ErrorMessage.tsx";

export function OrganizationPage() {
  const { orgId = "" } = useParams();
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: () => data(client.api.organizations.$get()),
  });
  const events = useQuery({
    queryKey: ["organizations", orgId, "events"],
    queryFn: () =>
      data(
        client.api.organizations[":orgId"].events.$get({ param: { orgId } }),
      ),
  });
  // The Events call is the access check (404 to a non-member), so its error replaces the whole page.
  if (events.isError) return <PageError error={events.error} />;
  if (organizations.isError) return <PageError error={organizations.error} />;
  if (events.isPending || organizations.isPending) return <Loading />;
  const org = organizations.data.find((o) => o.id === orgId);
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p>
          <Link to="/" className={ui.link}>
            ← Your Organizations
          </Link>
        </p>
        <h1 className={ui.h1}>{org?.name ?? "Organization"}</h1>
        {org && <p className={ui.muted}>Your role: {org.role}</p>}
      </div>
      <section className="space-y-3">
        <h2 className={ui.h2}>Events</h2>
        {events.data.length === 0 ? (
          <p className="text-stone-600">No Events yet.</p>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
            {events.data.map((event) => (
              <li key={event.id} className="px-4 py-3">
                <Link to={`/events/${event.id}`} className={ui.link}>
                  {event.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {org?.role === "owner" && <AddMember orgId={orgId} />}
    </div>
  );
}

const ROLES = ["owner", "editor", "viewer"] as const;
type Role = (typeof ROLES)[number];

function AddMember({ orgId }: { orgId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const add = useMutation({
    mutationFn: () =>
      data(
        client.api.organizations[":orgId"].members.$post({
          param: { orgId },
          json: { email, role },
        }),
      ),
    onSuccess: () => setEmail(""),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  return (
    <form onSubmit={submit} className={`${ui.card} space-y-4`}>
      <div>
        <h2 className={ui.h2}>Add a member</h2>
        <p className={ui.muted}>They need to have signed in once first.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className={ui.label}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={ui.input}
          />
        </label>
        <label className={ui.label}>
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className={ui.input}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={add.isPending} className={ui.button}>
          Add
        </button>
      </div>
      {add.isSuccess && (
        <p role="status" className={ui.success}>
          {add.data.email} is now {add.data.role === "viewer" ? "a" : "an"}{" "}
          {add.data.role}.
        </p>
      )}
      {add.isError && <ErrorMessage error={add.error} />}
    </form>
  );
}
