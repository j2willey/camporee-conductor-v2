import type { CheckedBundle } from "@camporee-conductor/cartridge";
import type { Db } from "./db/open.ts";

// The Awards page for Officials (#43 PR 1): the winners registry from packages/scoring, with names from the roster.
// The order is the registry's; nothing here ranks or sorts (CLAUDE.md rule 3).

export interface AwardLine {
  rank?: number;
  place?: string;
  entrantId: string;
  /** A Team's name and its Group's; a Group-level entrant has a Group and no Team; null names for an id off the roster. */
  entrant: { group: string | null; team: string | null };
  manual: boolean;
}

export interface AwardGroup {
  kind: "activity" | "award";
  id: string;
  /** The Activity's title or the Award's label. */
  title: string;
  lines: AwardLine[];
}

export interface AwardsView {
  /** True while any ranked Activity isn't finalized: the places may change. */
  provisional: boolean;
  finalizedCount: number;
  rankedCount: number;
  sections: {
    competition: { id: string; label: string };
    groups: AwardGroup[];
  }[];
}

export function officialAwards(_db: Db, _bundle: CheckedBundle): AwardsView {
  return { provisional: true, finalizedCount: 0, rankedCount: 0, sections: [] };
}
