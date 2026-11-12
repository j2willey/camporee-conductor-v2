import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
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
  const canEdit = org?.role === "owner" || org?.role === "editor";
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
          <div className={`${ui.card} space-y-2`}>
            <p className="font-medium">
              Welcome! This Organization has no Events yet.
            </p>
            <p className={ui.muted}>
              {canEdit
                ? "Start one below: give it a name, then add its Competitions, Activities and Common Fields."
                : "An editor or owner can start one."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
            {events.data.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <Link to={`/events/${event.id}`} className={ui.link}>
                  {event.title}
                </Link>
                {canEdit && (
                  <DuplicateEvent
                    orgId={orgId}
                    eventId={event.id}
                    title={event.title}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {canEdit && <NewEvent orgId={orgId} />}
      {canEdit && <ImportCartridge orgId={orgId} />}
      {org?.role === "owner" && <AddMember orgId={orgId} />}
    </div>
  );
}

/** A new, empty Event (#100): a title, and a slug made from it unless given. */
function NewEvent({ orgId }: { orgId: string }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () =>
      data(
        client.api.organizations[":orgId"].events.$post({
          param: { orgId },
          json: { title, ...(slug.trim() && { slug: slug.trim() }) },
        }),
      ),
    onSuccess: async ({ eventId }) => {
      await queryClient.invalidateQueries({
        queryKey: ["organizations", orgId, "events"],
      });
      void navigate(`/events/${eventId}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <form
      onSubmit={submit}
      className={`${ui.card} space-y-4`}
      aria-label="New Event"
    >
      <h2 className={ui.h2}>New Event</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className={`${ui.label} min-w-60 flex-1`}>
          Name
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="e.g. Coyote Creek Camporee 2027"
            className={ui.input}
          />
        </label>
        <label className={ui.label}>
          Slug (optional)
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="made from the name"
            className={`${ui.input} font-mono text-sm`}
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

/**
 * Imports a zip (#100): an Event's design cartridge, or a v1 Composer export. Importing the same one again
 * updates it. Says what came in, what a v1 import skipped, and each problem when it's refused.
 */
function ImportCartridge({ orgId }: { orgId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: (zip: File) =>
      data(
        client.api.organizations[":orgId"].import.$post({
          param: { orgId },
          form: { file: zip },
        }),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["organizations", orgId, "events"],
      }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (file) upload.mutate(file);
  };
  const result = upload.data;
  return (
    <form
      onSubmit={submit}
      className={`${ui.card} space-y-4`}
      aria-label="Import a cartridge"
    >
      <div>
        <h2 className={ui.h2}>Import a cartridge</h2>
        <p className={ui.muted}>
          An Event's design cartridge, or a v1 Composer export (.zip). Importing
          the same Event again updates it.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className={ui.label}>
          Zip file
          <input
            type="file"
            accept=".zip,application/zip"
            required
            className="text-sm"
            onChange={(e) => {
              upload.reset();
              setFile(e.target.files?.[0] ?? null);
            }}
          />
        </label>
        <button
          type="submit"
          disabled={!file || upload.isPending}
          className={ui.button}
        >
          {upload.isPending ? "Importing…" : "Import"}
        </button>
      </div>
      {upload.isError && (
        <p role="alert" className={`${ui.error} whitespace-pre-line`}>
          {upload.error.message}
        </p>
      )}
      {result && (
        <div role="status" className="space-y-2 text-sm">
          <p className={ui.success}>
            Imported{" "}
            <Link to={`/events/${result.eventId}`} className={ui.link}>
              {result.title}
            </Link>
            {result.source === "v1" ? " from v1" : ""}: {result.created}{" "}
            created, {result.updated} updated.
          </p>
          {result.skipped.length > 0 && (
            <div>
              <p className="font-medium text-amber-800">
                Skipped (not imported):
              </p>
              <ul className="list-disc pl-6">
                {result.skipped.map((s) => (
                  <li key={s.game}>
                    {s.game}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.leftovers.length > 0 && (
            <div>
              <p className="font-medium">
                No longer in the cartridge (kept, but not in the Event):
              </p>
              <ul className="list-disc pl-6">
                {result.leftovers.map((l) => (
                  <li key={l.slug}>{l.title}</li>
                ))}
              </ul>
            </div>
          )}
          {result.notes.length > 0 && (
            <ul className={`${ui.muted} list-disc pl-6`}>
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

/** Copies the Event with new ids, without its Officials (#100), then opens the copy. */
function DuplicateEvent({
  orgId,
  eventId,
  title,
}: {
  orgId: string;
  eventId: string;
  title: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const copy = useMutation({
    mutationFn: () =>
      data(
        client.api.events[":eventId"].duplicate.$post({
          param: { eventId },
          json: {},
        }),
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: ["organizations", orgId, "events"],
      });
      void navigate(`/events/${result.eventId}`);
    },
  });
  return (
    <span className="flex items-center gap-2">
      {copy.isError && (
        <span role="alert" className={ui.error}>
          {copy.error.message}
        </span>
      )}
      <button
        type="button"
        className={ui.buttonQuiet}
        aria-label={`Duplicate ${title}`}
        disabled={copy.isPending}
        onClick={() => {
          if (
            window.confirm(
              `Copy ${title}, with all its Activities? Its Officials aren't copied.`,
            )
          ) {
            copy.mutate();
          }
        }}
      >
        {copy.isPending ? "Copying…" : "Duplicate"}
      </button>
    </span>
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
