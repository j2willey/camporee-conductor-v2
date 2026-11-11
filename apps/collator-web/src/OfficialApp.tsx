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
import { AwardsPage } from "./screens/AwardsPage.tsx";
import { AnnouncerPage } from "./screens/AnnouncerPage.tsx";
import { StickersPage } from "./screens/StickersPage.tsx";
import { ExhibitionResultsPage } from "./screens/ExhibitionResultsPage.tsx";
import { OfficialActivityView } from "./screens/OfficialActivityView.tsx";
import { OfficialOverview } from "./screens/OfficialOverview.tsx";
import { OfficialSignIn } from "./screens/OfficialSignIn.tsx";
import { ResetPage } from "./screens/ResetPage.tsx";
import { RosterPage } from "./screens/RosterPage.tsx";
import { QrCodesPage } from "./screens/QrCodesPage.tsx";
import { StandingsPage } from "./screens/StandingsPage.tsx";
import { ui } from "./ui.ts";

// The Official view (#40 PR 3), at /official: sign in with an email on the Event's Officials list, see the
// Overview (#42 PR 1: every Activity's status, refreshed every 15 s), open an Activity for its ranking and
// the score entries received. Read-only; Officials' tools are the rest of #42. The QR codes to print are
// here too (#41 PR 7): Officials work in a laptop browser.

type Activity = OfficialEvent["activities"][number];

export function OfficialApp() {
  const [email, setEmail] = useState<string | null>(savedOfficialEmail);
  const [official, setOfficial] = useState<SignedInOfficial | null>(null);
  const [event, setEvent] = useState<OfficialEvent | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [printing, setPrinting] = useState(false);
  const [standings, setStandings] = useState(false);
  const [awardsOpen, setAwardsOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  const [announcerOpen, setAnnouncerOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

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
    setPrinting(false);
    setStandings(false);
    setAwardsOpen(false);
    setStickersOpen(false);
    setAnnouncerOpen(false);
    setRosterOpen(false);
    setResetting(false);
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
    <Shell wide>
      <header className="mb-4 flex flex-col gap-1 print:hidden">
        <p className={ui.muted}>{event.event.title}</p>
        <p className="text-sm">
          Signed in as <strong>{official.name ?? official.email}</strong>.{" "}
          <button className={ui.link} onClick={signOut}>
            Sign out
          </button>
        </p>
      </header>
      {printing ? (
        <QrCodesPage
          eventTitle={event.event.title}
          activities={event.activities}
          onBack={() => setPrinting(false)}
        />
      ) : standings ? (
        <StandingsPage
          email={email}
          labels={event.event.labels}
          onBack={() => setStandings(false)}
        />
      ) : awardsOpen && stickersOpen ? (
        <StickersPage email={email} onBack={() => setStickersOpen(false)} />
      ) : awardsOpen && announcerOpen ? (
        <AnnouncerPage email={email} onBack={() => setAnnouncerOpen(false)} />
      ) : awardsOpen ? (
        <AwardsPage
          email={email}
          onBack={() => setAwardsOpen(false)}
          onStickers={() => setStickersOpen(true)}
          onAnnouncer={() => setAnnouncerOpen(true)}
        />
      ) : resetting ? (
        <ResetPage
          email={email}
          eventTitle={event.event.title}
          onBack={() => setResetting(false)}
        />
      ) : rosterOpen ? (
        <RosterPage
          email={email}
          labels={event.event.labels}
          onBack={() => setRosterOpen(false)}
        />
      ) : activity?.scoringType === "exhibition" ? (
        <ExhibitionResultsPage
          email={email}
          activityId={activity.id}
          labels={event.event.labels}
          onBack={() => setActivity(null)}
        />
      ) : activity ? (
        <OfficialActivityView
          email={email}
          activityId={activity.id}
          labels={event.event.labels}
          onBack={() => setActivity(null)}
        />
      ) : (
        <OfficialOverview
          email={email}
          event={event}
          onPick={setActivity}
          onPrint={() => setPrinting(true)}
          onStandings={() => setStandings(true)}
          onAwards={() => setAwardsOpen(true)}
          onRoster={() => setRosterOpen(true)}
          onReset={() => setResetting(true)}
        />
      )}
    </Shell>
  );
}

function Shell({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <main
      className={`mx-auto px-4 py-4 ${wide ? "max-w-5xl print:max-w-none print:p-0" : "max-w-md"}`}
    >
      {children}
    </main>
  );
}
