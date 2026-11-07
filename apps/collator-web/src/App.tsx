import type {
  JudgeActivity,
  JudgeEvent,
  JudgeIdentity,
} from "@camporee-conductor/collator/types";
import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { levelLabel } from "./format.ts";
import { savedJudge } from "./identity.ts";
import { loadKept } from "./offline-data.ts";
import { closing } from "./phone-closing.ts";
import type { SendNowResult } from "./outbox.ts";
import { LoadProblem } from "./screens/LoadProblem.tsx";
import { OutboxStatus } from "./screens/OutboxStatus.tsx";
import { ActivityList } from "./screens/ActivityList.tsx";
import { EntrantPicker, type Entrant } from "./screens/EntrantPicker.tsx";
import { JudgeDetails } from "./screens/JudgeDetails.tsx";
import { Saved } from "./screens/Saved.tsx";
import { ScoreForm } from "./screens/ScoreForm.tsx";
import { BuildStamp } from "./screens/BuildStamp.tsx";
import { ui } from "./ui.ts";

// The judge page (#40 PR 2): who's judging → Activity → Team (or Group) → form → saved.
// No account (ADR-0023). Scores and roster adds go through the phone's outbox (#41 PR 2), and the page
// opens with no Wi-Fi from the copies kept on the phone (#41 PR 3). Half-filled forms and stopwatches are
// kept as drafts (#41 PR 4); Stations and QR codes come later in #41.

const EVENT_KEY = "collator.event";

type Step =
  | { name: "activity" }
  | { name: "entrant"; activity: JudgeActivity }
  | { name: "score"; activity: JudgeActivity; entrant: Entrant }
  | {
      name: "saved";
      activity: JudgeActivity;
      entrant: Entrant;
      result: Exclude<SendNowResult, { status: "refused" }>;
    };

export function App() {
  const [event, setEvent] = useState<JudgeEvent | null>(null);
  const [fromPhone, setFromPhone] = useState(false);
  const [eventChanged, setEventChanged] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [judge, setJudge] = useState<JudgeIdentity | null>(savedJudge);
  const [editingJudge, setEditingJudge] = useState(false);
  const [step, setStep] = useState<Step>({ name: "activity" });

  useEffect(() => {
    loadKept(EVENT_KEY, api.event, localStorage).then(
      (kept) => {
        setEvent(kept.value);
        setFromPhone(kept.fromPhone);
      },
      (e: unknown) => setLoadError(e),
    );
  }, []);

  // When the phone is back in range or the page is shown again, ask the box whether the event changed
  // (a new cartridge loaded). The page keeps the event it has until the Judge reloads.
  useEffect(() => {
    if (!event) return;
    const check = () => {
      loadKept(EVENT_KEY, api.event, localStorage).then(
        (kept) => {
          if (kept.fromPhone) return;
          setFromPhone(false);
          if (JSON.stringify(kept.value) !== JSON.stringify(event))
            setEventChanged(true);
        },
        () => {},
      );
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [event]);

  if (loadError !== null) {
    return (
      <Shell>
        <LoadProblem error={loadError} />
      </Shell>
    );
  }
  if (!event) {
    return (
      <Shell>
        <p className={ui.muted}>Loading…</p>
      </Shell>
    );
  }

  const header = (
    <header className="mb-4 flex flex-col gap-1">
      <p className={ui.muted}>{event.event.title}</p>
      {judge && !editingJudge && (
        <p className="text-sm">
          Judging as <strong>{judge.name}</strong>
          {judge.homeGroup && ` (${judge.homeGroup})`}.{" "}
          <button className={ui.link} onClick={() => setEditingJudge(true)}>
            Not you?
          </button>
        </p>
      )}
      {fromPhone && (
        <p className={ui.muted} role="status">
          Can't reach the scoring box: using the event saved on this phone.
        </p>
      )}
      {eventChanged && (
        <div className={ui.warning} role="alert">
          <p>The event was changed on the scoring box.</p>
          <button
            className={`${ui.link} mt-1`}
            onClick={() => window.location.reload()}
          >
            Reload to get the changes
          </button>
        </div>
      )}
      <OutboxStatus />
    </header>
  );

  if (!judge || editingJudge) {
    return (
      <Shell>
        {header}
        <JudgeDetails
          judge={judge}
          labels={event.event.labels}
          onSaved={(j) => {
            setJudge(j);
            setEditingJudge(false);
          }}
        />
      </Shell>
    );
  }

  const { labels } = event.event;
  return (
    <Shell>
      {header}
      {step.name === "activity" && (
        <ActivityList
          activities={event.activities}
          closed={closing.closedActivities(judge.id)}
          // Absent from an event kept on the phone before #41 PR 5.
          competitions={
            event.competitions as JudgeEvent["competitions"] | undefined
          }
          onPick={(activity) => setStep({ name: "entrant", activity })}
        />
      )}
      {step.name === "entrant" && (
        <EntrantPicker
          activity={step.activity}
          labels={labels}
          judge={judge}
          onPick={(entrant) => {
            // Scoring at a closed Activity reopens it, as in v1 (#41 PR 6).
            closing.reopen(judge.id, step.activity.id);
            setStep({ name: "score", activity: step.activity, entrant });
          }}
          onBack={() => setStep({ name: "activity" })}
        />
      )}
      {step.name === "score" && (
        <ScoreForm
          activity={step.activity}
          entrant={step.entrant}
          judge={judge}
          onSaved={(result) =>
            setStep({
              name: "saved",
              activity: step.activity,
              entrant: step.entrant,
              result,
            })
          }
          onBack={() => setStep({ name: "entrant", activity: step.activity })}
        />
      )}
      {step.name === "saved" && (
        <Saved
          activity={step.activity}
          entrant={step.entrant}
          result={step.result}
          entrantLabel={levelLabel(step.activity.competition.level, labels)}
          onNext={() => setStep({ name: "entrant", activity: step.activity })}
          onChangeActivity={() => setStep({ name: "activity" })}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-4 py-4">
      {children}
      <BuildStamp />
    </main>
  );
}
