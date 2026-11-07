import type { JudgeActivity } from "@camporee-conductor/collator/types";
import type { SendNowResult } from "../outbox.ts";
import { ui } from "../ui.ts";
import type { Entrant } from "./EntrantPicker.tsx";

export function Saved({
  activity,
  entrant,
  result,
  entrantLabel,
  onNext,
  onChangeActivity,
}: {
  activity: JudgeActivity;
  entrant: Entrant;
  result: Exclude<SendNowResult, { status: "refused" }>;
  entrantLabel: string;
  onNext: () => void;
  onChangeActivity: () => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      {result.status === "sent" ? (
        <p className={ui.success} role="status">
          Score saved: {entrant.label} at {activity.title}.
          {result.repeat && " (The box already had it.)"}
        </p>
      ) : (
        <p className={ui.warning} role="status">
          Score kept on this phone: {entrant.label} at {activity.title}. It will
          send when you're back in range of the scoring box.
        </p>
      )}
      <button className={ui.button} onClick={onNext}>
        Score another {entrantLabel}
      </button>
      <button className={ui.buttonQuiet} onClick={onChangeActivity}>
        Change Activity
      </button>
    </section>
  );
}
