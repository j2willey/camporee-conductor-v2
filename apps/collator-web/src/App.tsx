import type {
  JudgeActivity,
  JudgeEvent,
  JudgeIdentity,
} from "@camporee-conductor/collator/types";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api.ts";
import { savedJudge } from "./identity.ts";
import { ActivityList } from "./screens/ActivityList.tsx";
import { EntrantPicker, type Entrant } from "./screens/EntrantPicker.tsx";
import { JudgeDetails } from "./screens/JudgeDetails.tsx";
import { Saved } from "./screens/Saved.tsx";
import { ScoreForm } from "./screens/ScoreForm.tsx";
import { ui } from "./ui.ts";

// The judge page (#40 PR 2): who's judging → Activity → Team (or Group) → form → saved.
// No account (ADR-0023). Offline queue, drafts, stopwatch and QR codes come with #41.

type Step =
  | { name: "activity" }
  | { name: "entrant"; activity: JudgeActivity }
  | { name: "score"; activity: JudgeActivity; entrant: Entrant }
  | {
      name: "saved";
      activity: JudgeActivity;
      entrant: Entrant;
      repeat: boolean;
    };

export function App() {
  const [event, setEvent] = useState<JudgeEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [judge, setJudge] = useState<JudgeIdentity | null>(savedJudge);
  const [editingJudge, setEditingJudge] = useState(false);
  const [step, setStep] = useState<Step>({ name: "activity" });

  useEffect(() => {
    api
      .event()
      .then(setEvent, (e: unknown) =>
        setLoadError(e instanceof ApiError ? e.message : String(e)),
      );
  }, []);

  if (loadError) {
    return (
      <Shell>
        <p className={ui.error}>{loadError}</p>
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
          Judging as <strong>{judge.name}</strong>.{" "}
          <button className={ui.link} onClick={() => setEditingJudge(true)}>
            Not you?
          </button>
        </p>
      )}
    </header>
  );

  if (!judge || editingJudge) {
    return (
      <Shell>
        {header}
        <JudgeDetails
          judge={judge}
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
          onPick={(activity) => setStep({ name: "entrant", activity })}
        />
      )}
      {step.name === "entrant" && (
        <EntrantPicker
          activity={step.activity}
          labels={labels}
          onPick={(entrant) =>
            setStep({ name: "score", activity: step.activity, entrant })
          }
          onBack={() => setStep({ name: "activity" })}
        />
      )}
      {step.name === "score" && (
        <ScoreForm
          activity={step.activity}
          entrant={step.entrant}
          judge={judge}
          onSaved={(repeat) =>
            setStep({
              name: "saved",
              activity: step.activity,
              entrant: step.entrant,
              repeat,
            })
          }
          onBack={() => setStep({ name: "entrant", activity: step.activity })}
        />
      )}
      {step.name === "saved" && (
        <Saved
          activity={step.activity}
          entrant={step.entrant}
          repeat={step.repeat}
          entrantLabel={
            step.activity.competition.level === "team"
              ? labels.team
              : labels.group
          }
          onNext={() => setStep({ name: "entrant", activity: step.activity })}
          onChangeActivity={() => setStep({ name: "activity" })}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-md px-4 py-4">{children}</main>;
}
