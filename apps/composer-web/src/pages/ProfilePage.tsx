import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { client, data } from "../api.ts";
import { ui } from "../ui.ts";
import { ErrorMessage, Loading, PageError } from "./ErrorMessage.tsx";

type Me = Awaited<ReturnType<typeof readMe>>;
const readMe = () => data(client.api.me.$get());

/**
 * Your profile (ADR-0032 notes, #104 PR 2; v1's `user_profiles`): a display name, shown in the header and to the
 * Organizations you're in, and an organizer name. Your own only; the email comes from your sign-in.
 */
export function ProfilePage() {
  const me = useQuery({ queryKey: ["me"], queryFn: readMe });
  if (me.isPending) return <Loading />;
  if (me.isError) return <PageError error={me.error} />;
  return <ProfileForm me={me.data} />;
}

function ProfileForm({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(me.displayName ?? "");
  const [organizerName, setOrganizerName] = useState(me.organizerName ?? "");
  const save = useMutation({
    mutationFn: () =>
      data(client.api.me.$put({ json: { displayName, organizerName } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });
  const dirty =
    displayName !== (me.displayName ?? "") ||
    organizerName !== (me.organizerName ?? "");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className={ui.h1}>Your profile</h1>
        <p className="text-stone-600">
          Signed in as {me.email}. Your display name is shown in the header and
          to the Organizations you're in.
        </p>
      </div>
      <form
        className={`${ui.card} max-w-lg space-y-4`}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className={ui.label}>
          Display name
          <input
            className={ui.input}
            value={displayName}
            maxLength={100}
            autoComplete="name"
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label className={ui.label}>
          Organizer name
          <input
            className={ui.input}
            value={organizerName}
            maxLength={100}
            placeholder="e.g. your council or district"
            onChange={(e) => setOrganizerName(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className={ui.button}
            disabled={!dirty || save.isPending}
          >
            Save
          </button>
          {save.isSuccess && !dirty && (
            <span role="status" className={ui.success}>
              Saved.
            </span>
          )}
        </div>
        {save.error && <ErrorMessage error={save.error} />}
      </form>
    </div>
  );
}
