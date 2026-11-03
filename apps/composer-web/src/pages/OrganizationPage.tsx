import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { client, data } from "../api.ts";
import { ErrorMessage } from "./ErrorMessage.tsx";

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
  const org = organizations.data?.find((o) => o.id === orgId);
  return (
    <>
      <p>
        <Link to="/">← Organizations</Link>
      </p>
      <h1>{org?.name ?? "Organization"}</h1>
      {org && <p>Your role: {org.role}</p>}
      <h2>Events</h2>
      {events.isPending && <p>Loading…</p>}
      {events.isError && <ErrorMessage error={events.error} />}
      {events.data?.length === 0 && <p>No Events yet.</p>}
      <ul>
        {events.data?.map((event) => (
          <li key={event.id}>
            <Link to={`/events/${event.id}`}>{event.title}</Link>
          </li>
        ))}
      </ul>
      {org?.role === "owner" && <AddMember orgId={orgId} />}
    </>
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
    <form onSubmit={submit}>
      <h2>Add a member</h2>
      <p>They need to have signed in once first.</p>
      <label>
        Email{" "}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>{" "}
      <label>
        Role{" "}
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>{" "}
      <button type="submit" disabled={add.isPending}>
        Add
      </button>
      {add.isSuccess && (
        <p role="status">
          {add.data.email} is now {add.data.role === "viewer" ? "a" : "an"}{" "}
          {add.data.role}.
        </p>
      )}
      {add.isError && <ErrorMessage error={add.error} />}
    </form>
  );
}
