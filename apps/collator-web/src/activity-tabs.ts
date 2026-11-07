import type {
  JudgeActivity,
  JudgeCompetition,
} from "@camporee-conductor/collator/types";

// The Activity list, one Competition at a time (#41 PR 5): a Judge at the morning's Patrol Games doesn't
// need the afternoon's Troop Challenges in the way. The phone remembers the tab.

export interface CompetitionTab {
  id: string;
  label: string;
  /** How many Activities it has. */
  count: number;
}

/**
 * One tab per Competition that has Activities, in the event's Competition order. An event kept on the
 * phone from before the box sent that order (#41 PR 5) has none: then the order the Activities come in.
 */
export function competitionTabs(
  activities: readonly JudgeActivity[],
  competitions: readonly JudgeCompetition[] | undefined,
): CompetitionTab[] {
  const tabs = new Map<string, CompetitionTab>();
  for (const { competition } of activities) {
    const tab = tabs.get(competition.id);
    if (tab) tab.count += 1;
    else
      tabs.set(competition.id, {
        id: competition.id,
        label: competition.label,
        count: 1,
      });
  }
  const order = (competitions ?? []).map((c) => c.id);
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  // A stable sort: Competitions the list doesn't name keep their order, after the named ones.
  return [...tabs.values()].sort((a, b) => rank(a.id) - rank(b.id));
}

/** The remembered tab if this event has it; otherwise the first. */
export function shownTab(
  tabs: readonly CompetitionTab[],
  remembered: string | null,
): string | undefined {
  return tabs.find((t) => t.id === remembered)?.id ?? tabs[0]?.id;
}
