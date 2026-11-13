import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { ClientResponse } from "hono/client";
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
                  <span className="flex flex-wrap items-center gap-2">
                    <SaveAsTemplate eventId={event.id} title={event.title} />
                    <DuplicateEvent
                      orgId={orgId}
                      eventId={event.id}
                      title={event.title}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {canEdit && <NewEvent orgId={orgId} />}
      {canEdit && <ImportCartridge orgId={orgId} />}
      <Members orgId={orgId} isOwner={org?.role === "owner"} />
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

/**
 * Save Event as Template (#102 PR 4): a private Template in this Organization, without contacts or Officials, then
 * the Library page, where it's listed. A curator can publish it there.
 */
function SaveAsTemplate({
  eventId,
  title,
}: {
  eventId: string;
  title: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      data(
        client.api.events[":eventId"]["save-as-template"].$post({
          param: { eventId },
          json: {},
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["library"] });
      void navigate("/library");
    },
  });
  return (
    <>
      {save.isError && (
        <span role="alert" className={ui.error}>
          {save.error.message}
        </span>
      )}
      <button
        type="button"
        className={ui.buttonQuiet}
        aria-label={`Save ${title} as a Template`}
        disabled={save.isPending}
        onClick={() => {
          if (
            window.confirm(
              `Save ${title} as a Template, with all its Activities? Its contacts and Officials stay out.`,
            )
          ) {
            save.mutate();
          }
        }}
      >
        {save.isPending ? "Saving…" : "Save as Template"}
      </button>
    </>
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

/**
 * Who's in the Organization (#101): everyone sees the list; owners change roles, remove members and add them.
 * The API keeps at least one owner and says so when a change would leave none.
 */
function Members({ orgId, isOwner }: { orgId: string; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: ["organizations", orgId, "members"],
    queryFn: () =>
      data(
        client.api.organizations[":orgId"].members.$get({ param: { orgId } }),
      ),
  });
  const change = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ["organizations", orgId, "members"],
      }),
  });
  const member = client.api.organizations[":orgId"].members[":userId"];
  return (
    <section className="space-y-3" aria-label="Members">
      <h2 className={ui.h2}>Members</h2>
      {members.isPending && <p className={ui.muted}>Loading…</p>}
      {members.isError && <ErrorMessage error={members.error} />}
      {members.data && (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
          {members.data.map((m) => (
            <li
              key={m.userId}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
            >
              <span>
                {m.displayName ? (
                  <>
                    {m.displayName}{" "}
                    <span className={ui.muted}>({m.email})</span>
                  </>
                ) : (
                  m.email
                )}
              </span>
              {isOwner ? (
                <span className="flex items-center gap-2">
                  <select
                    className={ui.input}
                    aria-label={`Role of ${m.email}`}
                    value={m.role}
                    disabled={change.isPending}
                    onChange={(e) => {
                      const role = e.target.value as Role;
                      change.mutate(() =>
                        data(
                          member.$patch({
                            param: { orgId, userId: m.userId },
                            json: { role },
                          }),
                        ),
                      );
                    }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={ui.buttonQuiet}
                    aria-label={`Remove ${m.email}`}
                    disabled={change.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${m.email} from this Organization?`,
                        )
                      ) {
                        change.mutate(() =>
                          data(
                            member.$delete({
                              param: { orgId, userId: m.userId },
                            }),
                          ),
                        );
                      }
                    }}
                  >
                    Remove
                  </button>
                </span>
              ) : (
                <span className={ui.muted}>{m.role}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {change.isError && <ErrorMessage error={change.error} />}
      {isOwner && <Invites orgId={orgId} />}
      {isOwner && <AddMember orgId={orgId} />}
    </section>
  );
}

type Added =
  | { userId: string; email: string; role: Role }
  | { invited: true; email: string; role: Role };

const article = (role: string) => (role === "viewer" ? "a" : "an");

/** Pending invites (#35): owners see them and can revoke one. Nothing shows when there are none. */
function Invites({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const invites = useQuery({
    queryKey: ["organizations", orgId, "invites"],
    queryFn: () =>
      data(
        client.api.organizations[":orgId"].invites.$get({ param: { orgId } }),
      ),
  });
  const revoke = useMutation({
    mutationFn: (email: string) =>
      data(
        client.api.organizations[":orgId"].invites[":email"].$delete({
          param: { orgId, email },
        }),
      ),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ["organizations", orgId, "invites"],
      }),
  });
  if (!invites.data || invites.data.length === 0) {
    return invites.isError ? <ErrorMessage error={invites.error} /> : null;
  }
  return (
    <div className="space-y-2" aria-label="Pending invites" role="group">
      <h3 className="text-sm font-medium text-stone-700">
        Invited, not signed in yet
      </h3>
      <ul className="divide-y divide-stone-200 rounded-lg border border-dashed border-stone-300 bg-white">
        {invites.data.map((i) => (
          <li
            key={i.email}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
          >
            <span>
              {i.email} <span className={ui.muted}>({i.role})</span>
            </span>
            <button
              type="button"
              className={ui.buttonQuiet}
              aria-label={`Revoke the invite for ${i.email}`}
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(i.email)}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      {revoke.isError && <ErrorMessage error={revoke.error} />}
    </div>
  );
}

function AddMember({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const add = useMutation({
    mutationFn: () =>
      data(
        // A member, or a pending invite for someone who hasn't signed in yet (#35).
        client.api.organizations[":orgId"].members.$post({
          param: { orgId },
          json: { email, role },
        }) as Promise<ClientResponse<Added>>,
      ),
    onSuccess: () => {
      setEmail("");
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["organizations", orgId, "members"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["organizations", orgId, "invites"],
        }),
      ]);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  return (
    <form onSubmit={submit} className={`${ui.card} space-y-4`}>
      <div>
        <h2 className={ui.h2}>Add a member</h2>
        <p className={ui.muted}>
          Someone who hasn't signed in yet gets an invite. They're added when
          they first sign in with that email. No email is sent, so tell them.
        </p>
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
            aria-label="Role of the new member"
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
          {"invited" in add.data
            ? `${add.data.email} hasn't signed in yet: they'll be added as ${article(add.data.role)} ${add.data.role} when they sign in.`
            : `${add.data.email} is now ${article(add.data.role)} ${add.data.role}.`}
        </p>
      )}
      {add.isError && <ErrorMessage error={add.error} />}
    </form>
  );
}
