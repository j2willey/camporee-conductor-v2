import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { client, data } from "../api.ts";
import { ui } from "../ui.ts";
import { ErrorMessage, Loading, PageError } from "./ErrorMessage.tsx";

export function OrganizationsPage() {
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: () => data(client.api.organizations.$get()),
  });
  if (organizations.isPending) return <Loading />;
  if (organizations.isError) return <PageError error={organizations.error} />;
  return (
    <div className="space-y-8">
      <h1 className={ui.h1}>Your Organizations</h1>
      {organizations.data.length === 0 ? (
        <p className="text-stone-600">
          You're not in any Organization yet. Create one, or ask an owner to add
          you.
        </p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {organizations.data.map((org) => (
            <li
              key={org.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <Link to={`/organizations/${org.id}`} className={ui.link}>
                {org.name}
              </Link>
              <span className={ui.muted}>{org.role}</span>
            </li>
          ))}
        </ul>
      )}
      <CreateOrganization />
    </div>
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
    <form onSubmit={submit} className={`${ui.card} space-y-4`}>
      <h2 className={ui.h2}>Create an Organization</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className={ui.label}>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={ui.input}
          />
        </label>
        <label className={ui.label}>
          Slug
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="coyote-creek"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="Lowercase letters, digits and single hyphens"
            required
            className={ui.input}
          />
        </label>
        <button type="submit" disabled={create.isPending} className={ui.button}>
          Create
        </button>
      </div>
      {create.isError && <ErrorMessage error={create.error} />}
    </form>
  );
}
