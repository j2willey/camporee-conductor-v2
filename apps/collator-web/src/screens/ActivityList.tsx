import type {
  JudgeActivity,
  JudgeCompetition,
} from "@camporee-conductor/collator/types";
import { useState } from "react";
import { competitionTabs, shownTab } from "../activity-tabs.ts";
import { remember, remembered } from "../remembered.ts";
import { ui } from "../ui.ts";

const TAB_KEY = "collator.competition";
const LAST_KEY = "collator.lastActivity";

/**
 * Every Activity, one Competition at a time (#41 PR 5): tabs, as v1's Patrol / Troop tabs, so the
 * morning's Patrol Games and the afternoon's Troop Challenges don't crowd each other. The phone remembers
 * the tab, and offers the Activity last picked at the top. The Judge chooses; nothing enforces an
 * assignment (ADR-0027 item 6).
 */
export function ActivityList({
  activities,
  competitions,
  onPick,
}: {
  activities: readonly JudgeActivity[];
  competitions: readonly JudgeCompetition[] | undefined;
  onPick: (activity: JudgeActivity) => void;
}) {
  const tabs = competitionTabs(activities, competitions);
  const [tab, setTab] = useState(() => shownTab(tabs, remembered(TAB_KEY)));
  const last = activities.find((a) => a.id === remembered(LAST_KEY));

  const pick = (activity: JudgeActivity) => {
    remember(LAST_KEY, activity.id);
    remember(TAB_KEY, activity.competition.id);
    onPick(activity);
  };
  const show = (id: string) => {
    setTab(id);
    remember(TAB_KEY, id);
  };

  return (
    <section className="flex flex-col gap-4">
      <h1 className={ui.h1}>Which Activity are you judging?</h1>
      {last && (
        <button className={`${ui.button} text-left`} onClick={() => pick(last)}>
          Back to {last.title}
        </button>
      )}
      {tabs.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === tab}
              className={
                t.id === tab
                  ? "rounded-full bg-teal-700 px-3 py-2 text-sm font-medium text-white"
                  : "rounded-full border border-stone-300 bg-white px-3 py-2 text-sm"
              }
              onClick={() => show(t.id)}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2" role="tabpanel">
        {activities
          .filter((a) => a.competition.id === tab)
          .map((activity) => (
            <button
              key={activity.id}
              className={ui.choice}
              onClick={() => pick(activity)}
            >
              {activity.title}
            </button>
          ))}
      </div>
    </section>
  );
}
