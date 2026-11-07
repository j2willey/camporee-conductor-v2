import type { JudgeActivity } from "@camporee-conductor/collator/types";
import { ui } from "../ui.ts";
import type { Entrant } from "./EntrantPicker.tsx";

export function Saved({
  activity,
  entrant,
  repeat,
  entrantLabel,
  onNext,
  onChangeActivity,
}: {
  activity: JudgeActivity;
  entrant: Entrant;
  repeat: boolean;
  entrantLabel: string;
  onNext: () => void;
  onChangeActivity: () => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <p className={ui.success} role="status">
        Score saved: {entrant.label} at {activity.title}.
        {repeat && " (The box already had it.)"}
      </p>
      <button className={ui.button} onClick={onNext}>
        Score another {entrantLabel}
      </button>
      <button className={ui.buttonQuiet} onClick={onChangeActivity}>
        Change Activity
      </button>
    </section>
  );
}
