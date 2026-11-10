import type {
  Activity,
  CommonFieldSet,
  Event,
} from "@camporee-conductor/schema";

/** A value as a Judge or Official entered it. Raw entries are stored as entered (ADR-0019). */
export type FieldValue = number | string | boolean | null;

/** One Judge's score entry for one entrant at one Activity. */
export interface ScoreEntry {
  /** The Collator's score entry id; corrections name it (ADR-0019). Optional for fixtures without ids. */
  id?: string;
  /** The Judge who entered it; two different Judges for one entrant make a conflict (ADR-0019). Optional for fixtures. */
  judgeId?: string;
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
    }
  | {
      /** Gives (`awarded: true`) or takes away (`false`) an Award, overriding its rule (ADR-0019). */
      type: "set-award";
      awardId: string;
      entrantId: string;
      awarded: boolean;
      /** For a named-places Award: which place's name the recipient gets. Must be one of its names. */
      place?: string;
      notes?: string;
    }
  | {
      /**
       * Overrides an entrant's overall rank in a Competition. Nobody else is re-sorted: the Official
       * owns the result (ADR-0019).
       */
      type: "set-overall-rank";
      competitionId: string;
      entrantId: string;
      rank: number;
      notes?: string;
    }
  | {
      /**
       * DQ (`disqualified: true`) or reinstate (`false`) an entrant at one Activity, or overall when
       * `activityId` is left out (ADR-0019).
       */
      type: "disqualify";
      activityId?: string;
      entrantId: string;
      disqualified: boolean;
      notes?: string;
    }
  | {
      /**
       * An Official's value for one field of one Judge's score entry. The entry is kept as entered;
       * scoring lays the value over it before totalling and listing. A null value clears the field.
       * It belongs to that entry: a newer entry for the entrant counts as entered (ADR-0019).
       */
      type: "set-field-value";
      activityId: string;
      entrantId: string;
      entryId: string;
      fieldId: string;
      value: FieldValue;
      notes?: string;
    }
  | {
      /** Undoes a correction: the Judge's value counts again. The latest for an entry and field wins. */
      type: "revert-field-value";
      activityId: string;
      entrantId: string;
      entryId: string;
      fieldId: string;
      notes?: string;
    }
  | {
      /**
       * An Official's choice of which of an entrant's entries counts at an Activity. `newestEntryId` is
       * the newest entry the Official saw: if a newer one arrives, the choice reopens and the newest
       * counts again. Choosing the newest accepts the default (ADR-0019 2026-11-10).
       */
      type: "choose-entry";
      activityId: string;
      entrantId: string;
      entryId: string;
      newestEntryId: string;
      notes?: string;
    }
  | {
      /**
       * Freezes the Activity's Final Ranking as `ranking`, which stores what the Official saw. Until
       * `unfinalize`, scoring returns it as stored and never re-sorts it (ADR-0019).
       */
      type: "finalize";
      activityId: string;
      ranking: FinalizedResult[];
      notes?: string;
    }
  | {
      /** Reopens a finalized Activity; actions held back since `finalize` then apply (ADR-0019). */
      type: "unfinalize";
      activityId: string;
      notes?: string;
    };

/** One entrant's result as a `finalize` action froze it: a rank and placement points, or DQ. */
export type FinalizedResult =
  | { entrantId: string; rank: number; points: number; disqualified: false }
  | { entrantId: string; disqualified: true };

export interface ScoringInput {
  event: Event;
  activities: readonly Activity[];
  commonFieldSets: readonly CommonFieldSet[];
  entrants: readonly Entrant[];
  entries: readonly ScoreEntry[];
  actions: readonly OfficialAction[];
}

/** One entrant's result at one Activity: ranked, or DQ'd (no rank, 0 placement points). */
export type EntryResult = RankedEntry | DisqualifiedEntry;

/** What scoring used for an entrant at an Activity, reported with its result (ADR-0019 2026-11-10). */
export interface EntryReport {
  /** The counting entry's id; undefined when entries carry no ids. */
  entryId?: string;
  /** The values scoring used: the counting entry's, with its applied corrections laid over them. */
  values: Record<string, FieldValue>;
  /** Every effective correction (the latest set, not reverted, per entry and field) on this entrant's entries here. */
  corrections: CorrectionReport[];
  /** Conflict state (ADR-0019 2026-11-10). Without an Official's choice: "none" or "unresolved". */
  conflict: "none" | "unresolved" | "resolved" | "reopened";
  /**
   * The latest `choose-entry` for the entrant here, if any. applied: it decides which entry counts.
   * reopened: a newer entry arrived after it, so the newest counts. held: logged after the `finalize`.
   */
  choice?: {
    actionIndex: number;
    entryId: string;
    state: "applied" | "reopened" | "held";
  };
}

/** One effective field correction and what became of it. */
export interface CorrectionReport {
  /** Index of the action in `ScoringInput.actions` as given, so callers can say who and when. */
  actionIndex: number;
  entryId: string;
  fieldId: string;
  value: FieldValue;
  /** The value on its entry as the Judge entered it; null when blank or missing. */
  original: FieldValue;
  /**
   * applied: on the counting entry. held: logged after the `finalize` that freezes the Activity.
   * superseded: on an entry a newer entry replaced by default. not-counting: on an entry an Official
   * chose not to count.
   */
  state: "applied" | "superseded" | "not-counting" | "held";
}

export interface RankedEntry extends EntryReport {
  entrantId: string;
  total: number;
  /** Rank by total within the Activity, before any Official override. */
  provisionalRank: number;
  /** The Official's rank override if one is logged, otherwise the Provisional Ranking. */
  finalRank: number;
  /** Placement points: the Official's entered points if logged, otherwise from the Final Ranking. */
  points: number;
  disqualified: false;
}

/** DQ'd at this Activity: removed before ranking, so it has no rank (ADR-0019). */
export interface DisqualifiedEntry extends EntryReport {
  entrantId: string;
  total: number;
  points: 0;
  disqualified: true;
}

export interface ActivityResults {
  activityId: string;
  competitionId: string;
  /** Finalized by an Official: `entries` are the stored Final Ranking, in its order (ADR-0019). */
  finalized: boolean;
  entries: EntryResult[];
}

/** One entrant's place in a Competition overall: ranked, or DQ'd overall (no rank). */
export type Standing = RankedStanding | DisqualifiedStanding;

export interface RankedStanding {
  entrantId: string;
  /** Sum of placement points over the Competition's ranked Activities; no entry = 0. */
  total: number;
  /** Rank by total, before any Official override. */
  provisionalRank: number;
  /** The Official's `set-overall-rank` if one is logged, otherwise the provisional rank. Awards use it. */
  rank: number;
  disqualified: false;
}

/** DQ'd overall: keeps its total, removed before ranking, no automatic Award (ADR-0019). */
export interface DisqualifiedStanding {
  entrantId: string;
  total: number;
  disqualified: true;
}

export interface CompetitionStandings {
  competitionId: string;
  entrants: Standing[];
}

/** One entrant receiving an Award. */
export interface AwardRecipient {
  entrantId: string;
  /** The place's name, for a named-places Award. */
  place?: string;
  /** Given by an Official's `set-award` action rather than the Award's rule. */
  manual: boolean;
}

export interface AwardResults {
  awardId: string;
  recipients: AwardRecipient[];
}

/**
 * Something an Official should look at. Scoring never fails on bad data or a bad action; it carries on
 * and says so here.
 */
export type ScoringWarning = ActionWarning | EntryWarning;

/**
 * An Official action that scoring left out because it's invalid, e.g. a `set-award` place the Award
 * doesn't have, or a `set-overall-rank` that isn't a whole number from 1. The log is append-only, so
 * scoring never fails on one; the Collator should reject them when they're written.
 */
export interface ActionWarning {
  action: OfficialAction;
  message: string;
}

/**
 * An entered value scoring couldn't read, e.g. a primary stopwatch time typed as `"7.47"`. The entry
 * is listed as if it had no value (ADR-0019 Measured Activities).
 */
export interface EntryWarning {
  activityId: string;
  entrantId: string;
  fieldId: string;
  value: FieldValue;
  message: string;
}

export interface EventResults {
  activities: ActivityResults[];
  standings: CompetitionStandings[];
  awards: AwardResults[];
  warnings: ScoringWarning[];
}
