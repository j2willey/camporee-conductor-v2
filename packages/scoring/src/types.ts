import type {
  Activity,
  CommonFieldSet,
  Event,
} from "@camporee-conductor/schema";

/** A value as a Judge or Official entered it. Raw entries are stored as entered (ADR-0019). */
export type FieldValue = number | string | boolean | null;

/** One Judge's score entry for one entrant at one Activity. */
export interface ScoreEntry {
  activityId: string;
  /** A Team or Group from the Collator roster, by the Competition's `level`. */
  entrantId: string;
  /** Field id → value. */
  values: Readonly<Record<string, FieldValue>>;
}

/** Who enters a Competition. Rosters live in the Collator (ADR-0026). */
export interface Entrant {
  id: string;
  competitionId: string;
}

/** A logged Official action. Applied in log order. */
export type OfficialAction =
  | {
      /** Points an Official adds to an entry's total (v1 "Official Score"); negative subtracts. */
      type: "adjust-points";
      activityId: string;
      entrantId: string;
      points: number;
      notes?: string;
    }
  | {
      type: "set-final-rank";
      activityId: string;
      entrantId: string;
      rank: number;
      notes?: string;
    }
  | {
      type: "set-placement-points";
      activityId: string;
      entrantId: string;
      points: number;
      notes?: string;
    };

export interface ScoringInput {
  event: Event;
  activities: readonly Activity[];
  commonFieldSets: readonly CommonFieldSet[];
  entrants: readonly Entrant[];
  entries: readonly ScoreEntry[];
  actions: readonly OfficialAction[];
}

export interface EntryResult {
  entrantId: string;
  total: number;
  /** Rank by total within the Activity, before any Official override. */
  provisionalRank: number;
  /** The Official's rank override if one is logged, otherwise the Provisional Ranking. */
  finalRank: number;
  /** Placement points: the Official's entered points if logged, otherwise from the Final Ranking. */
  points: number;
}

export interface ActivityResults {
  activityId: string;
  competitionId: string;
  entries: EntryResult[];
}

/** One entrant's place in a Competition overall. */
export interface Standing {
  entrantId: string;
  /** Sum of placement points over the Competition's ranked Activities; no entry = 0. */
  total: number;
  rank: number;
}

export interface CompetitionStandings {
  competitionId: string;
  entrants: Standing[];
}

export interface EventResults {
  activities: ActivityResults[];
  standings: CompetitionStandings[];
}
