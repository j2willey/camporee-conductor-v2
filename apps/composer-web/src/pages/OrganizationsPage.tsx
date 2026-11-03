import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { client, data } from "../api.ts";
import { ErrorMessage } from "./ErrorMessage.tsx";

export function OrganizationsPage() {
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: () => data(client.api.organizations.$get()),
  });
  return (
    <>
      <h1>Your Organizations</h1>
      {organizations.isPending && <p>Loading…</p>}
      {organizations.isError && <ErrorMessage error={organizations.error} />}
      {organizations.data?.length === 0 && (
        <p>
          You're not in any Organization yet. Create one, or ask an owner to add
          you.
        </p>
      )}
      <ul>
        {organizations.data?.map((org) => (
          <li key={org.id}>
            <Link to={`/organizations/${org.id}`}>{org.name}</Link> ({org.role})
          </li>
        ))}
      </ul>
      <CreateOrganization />
    </>
  );
}

function CreateOrganization() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const create = useMutation({
    mutationFn: () =>
      data(client.api.organizations.$post({ json: { name, slug } })),
    onSuccess: () => {
      setName("");
      setSlug("");
      return queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <form onSubmit={submit}>
      <h2>Create an Organization</h2>
      <label>
        Name{" "}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>{" "}
      <label>
        Slug{" "}
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="coyote-creek"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          title="Lowercase letters, digits and single hyphens"
          required
        />
      </label>{" "}
      <button type="submit" disabled={create.isPending}>
        Create
      </button>
      {create.isError && <ErrorMessage error={create.error} />}
    </form>
  );
}
