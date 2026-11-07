import type {
  OfficialEvent,
  SignedInOfficial,
} from "@camporee-conductor/collator/types";
import { useEffect, useState } from "react";
import { errorMessage, officialApi, wasRefused } from "./api.ts";
import {
  forgetOfficialEmail,
  savedOfficialEmail,
  saveOfficialEmail,
} from "./official-identity.ts";
import { OfficialActivityView } from "./screens/OfficialActivityView.tsx";
import { OfficialSignIn } from "./screens/OfficialSignIn.tsx";
import { ui } from "./ui.ts";

// The Official view (#40 PR 3), at /official: sign in with an email on the Event's Officials list, pick an
// Activity, see its ranking and the score entries received. Read-only; Officials' tools are #42.

type Activity = OfficialEvent["activities"][number];

export function OfficialApp() {
  const [email, setEmail] = useState<string | null>(savedOfficialEmail);
  const [official, setOfficial] = useState<SignedInOfficial | null>(null);
  const [event, setEvent] = useState<OfficialEvent | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);

  // Signing in, or coming back with a saved email: the box checks it, as it does on every call.
  useEffect(() => {
    if (!email) return;
    let current = true;
    Promise.all([officialApi.me(email), officialApi.event(email)]).then(
      ([me, ev]) => {
        if (!current) return;
        saveOfficialEmail(email);
        setOfficial(me);
        setEvent(ev);
        setProblem(null);
      },
      (e: unknown) => {
        if (!current) return;
        if (wasRefused(e)) {
          forgetOfficialEmail();
          setEmail(null);
        }
        setProblem(errorMessage(e));
      },
    );
    return () => {
      current = false;
    };
  }, [email]);

  const signOut = () => {
    forgetOfficialEmail();
    setEmail(null);
    setOfficial(null);
    setEvent(null);
    setActivity(null);
    setProblem(null);
  };

  if (!email) {
    return (
      <Shell>
        <OfficialSignIn problem={problem} onSignIn={setEmail} />
      </Shell>
    );
  }
  if (!official || !event) {
    return (
      <Shell>
        {problem ? (
          <p className={ui.error} role="alert">
            {problem}
          </p>
        ) : (
          <p className={ui.muted}>Checking…</p>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="mb-4 flex flex-col gap-1">
        <p className={ui.muted}>{event.event.title}</p>
        <p className="text-sm">
          Signed in as <strong>{official.name ?? official.email}</strong>.{" "}
          <button className={ui.link} onClick={signOut}>
            Sign out
          </button>
        </p>
      </header>
      {activity ? (
        <OfficialActivityView
          email={email}
          activityId={activity.id}
          labels={event.event.labels}
          onBack={() => setActivity(null)}
        />
      ) : (
        <ActivityPicker activities={event.activities} onPick={setActivity} />
      )}
    </Shell>
  );
}

function ActivityPicker({
  activities,
  onPick,
}: {
  activities: readonly Activity[];
  onPick: (activity: Activity) => void;
}) {
  const competitions = [
    ...new Map(
      activities.map((a) => [a.competition.id, a.competition]),
    ).values(),
  ];
  const entries = (n: number) => (n === 1 ? "1 entry" : `${n} entries`);
  return (
    <section className="flex flex-col gap-4">
      <h1 className={ui.h1}>Activities</h1>
      {competitions.map((competition) => (
        <section key={competition.id} className="flex flex-col gap-2">
          <h2 className={ui.h2}>{competition.label}</h2>
          {activities
            .filter((a) => a.competition.id === competition.id)
            .map((activity) => (
              <button
                key={activity.id}
                className={`${ui.choice} flex justify-between gap-2`}
                onClick={() => onPick(activity)}
              >
                <span>{activity.title}</span>
                <span className="flex flex-col items-end text-right">
                  <span className={ui.muted}>
                    {entries(activity.entryCount)}
                  </span>
                  {/* Judges' closures (#41 PR 6): an Official checks the ones that need a look. */}
                  {activity.closureProblems > 0 ? (
                    <span className="text-xs font-medium text-amber-800">
                      Check closures
                    </span>
                  ) : (
                    activity.closedBy > 0 && (
                      <span className="text-xs text-teal-800">
                        Closed by {activity.closedBy}
                      </span>
                    )
                  )}
                </span>
              </button>
            ))}
        </section>
      ))}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-md px-4 py-4">{children}</main>;
}
