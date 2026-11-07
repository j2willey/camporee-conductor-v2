import type { JudgeActivity } from "@camporee-conductor/collator/types";
import { ui } from "../ui.ts";

/** Every Activity, grouped by Competition. The Judge chooses; nothing enforces an assignment (ADR-0027 item 6). */
export function ActivityList({
  activities,
  onPick,
}: {
  activities: readonly JudgeActivity[];
  onPick: (activity: JudgeActivity) => void;
}) {
  const competitions = [
    ...new Map(
      activities.map((a) => [a.competition.id, a.competition]),
    ).values(),
  ];
  return (
    <section className="flex flex-col gap-4">
      <h1 className={ui.h1}>Which Activity are you judging?</h1>
      {competitions.map((competition) => (
        <section key={competition.id} className="flex flex-col gap-2">
          <h2 className={ui.h2}>{competition.label}</h2>
          {activities
            .filter((a) => a.competition.id === competition.id)
            .map((activity) => (
              <button
                key={activity.id}
                className={ui.choice}
                onClick={() => onPick(activity)}
              >
                {activity.title}
              </button>
            ))}
        </section>
      ))}
    </section>
  );
}
