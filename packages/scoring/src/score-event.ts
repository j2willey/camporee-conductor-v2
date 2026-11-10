import type { Activity } from "@camporee-conductor/schema";
import { actionProblem } from "./action-checks.ts";
import { awardRecipients } from "./awards.ts";
import { newestEntries } from "./entries.ts";
import {
  correctedValues,
  entryTotal,
  mergeCommonFields,
  metricValue,
  unreadableStopwatch,
} from "./fields.ts";
import {
  DEFAULT_PLACEMENT_POINTS,
  placementPoints,
  rankingFor,
} from "./ranking.ts";
import type {
  ActivityResults,
  CompetitionStandings,
  CorrectionReport,
  EntryReport,
  EntryResult,
  FieldValue,
  EventResults,
  OfficialAction,
  ScoreEntry,
  ScoringInput,
  ScoringWarning,
  Standing,
} from "./types.ts";

type ActionOf<T extends OfficialAction["type"]> = Extract<
  OfficialAction,
  { type: T }
>;

type SetFieldValue = ActionOf<"set-field-value">;
type RevertFieldValue = ActionOf<"revert-field-value">;

/** The latest logged action of this type, or undefined. Later actions supersede earlier ones. */
function latest<T extends OfficialAction["type"]>(
  actions: readonly OfficialAction[],
  type: T,
): ActionOf<T> | undefined {
  return actions.findLast((a): a is ActionOf<T> => a.type === type);
}

/**
 * The key an action is effective under: the latest `disqualify` per entrant and Activity (or overall), and
 * the latest `choose-entry` per entrant and Activity, the latest `set-field-value` or
 * `revert-field-value` per entry and field, the latest `adjust-points`, `set-final-rank` or
 * `set-placement-points` per type, Activity and entrant, the latest `set-overall-rank` per Competition and
 * entrant, and the latest `set-award` per Award and entrant. Undefined for `finalize` and `unfinalize`,
 * which `finalizations` checks itself.
 */
function effectiveKey(a: OfficialAction): string | undefined {
  if (a.type === "disqualify") {
    return `disqualify ${a.activityId ?? ""} ${a.entrantId}`;
  }
  if (a.type === "choose-entry") {
    return `choice ${a.activityId} ${a.entrantId}`;
  }
  if (a.type === "set-field-value" || a.type === "revert-field-value") {
    return `correction ${a.activityId} ${a.entrantId} ${a.entryId} ${a.fieldId}`;
  }
  if (
    a.type === "adjust-points" ||
    a.type === "set-final-rank" ||
    a.type === "set-placement-points"
  ) {
    return `${a.type} ${a.activityId} ${a.entrantId}`;
  }
  if (a.type === "set-overall-rank") {
    return `overall-rank ${a.competitionId} ${a.entrantId}`;
  }
  if (a.type === "set-award") return `award ${a.awardId} ${a.entrantId}`;
  return undefined;
}

/**
 * Leaves out each invalid effective action (the latest for its key) with one warning from `actionProblem`, the
 * single check the Collator also uses when it writes an action; `finalize` and `unfinalize` pass through in log
 * order (ADR-0019, #24). Everything after this can trust the actions it's given.
 */
function validActions(input: ScoringInput): {
  actions: readonly OfficialAction[];
  /** For each kept action, its index in the actions as given. */
  givenIndex: readonly number[];
  warnings: ScoringWarning[];
} {
  const effective = new Map<string, OfficialAction>();
  for (const a of input.actions) {
    const key = effectiveKey(a);
    if (key !== undefined) effective.set(key, a);
  }
  const warnings: ScoringWarning[] = [];
  const invalid = new Set<string>();
  for (const [key, action] of effective) {
    const message = actionProblem(input, action);
    if (message === undefined) continue;
    invalid.add(key);
    warnings.push({ action, message });
  }
  const kept = input.actions.flatMap((action, index) => {
    const key = effectiveKey(action);
    return key === undefined || !invalid.has(key) ? [{ action, index }] : [];
  });
  return {
    actions: kept.map((k) => k.action),
    givenIndex: kept.map((k) => k.index),
    warnings,
  };
}

const NO_REPORT: EntryReport = {
  values: {},
  corrections: [],
  conflict: "none",
};

/**
 * What scoring used for one entrant at one Activity: the counting entry's id and values, every effective
 * correction on the entrant's entries here with its state, the choice and the conflict state (ADR-0019
 * 2026-11-10). `mine` is the entrant's actions at the Activity with their index in the (filtered) log;
 * `frozenAt` is that index for the `finalize` freezing it, if any.
 */
function entryReport(
  counting: ScoreEntry,
  entrantEntries: readonly ScoreEntry[],
  values: Record<string, FieldValue>,
  choice: Choice | undefined,
  mine: readonly { action: OfficialAction; index: number }[],
  frozenAt: number | undefined,
  givenIndex: readonly number[],
): EntryReport {
  type Held = { action: SetFieldValue | RevertFieldValue; index: number };
  // The latest set or revert per entry and field, apart for what's held and what isn't. A held revert
  // is kept, so it can be reported: the standing correction it will undo still applies for now.
  const standing = new Map<string, Held>();
  const held = new Map<string, Held>();
  for (const { action, index } of mine) {
    if (
      action.type !== "set-field-value" &&
      action.type !== "revert-field-value"
    ) {
      continue;
    }
    const key = JSON.stringify([action.entryId, action.fieldId]);
    if (frozenAt !== undefined && index > frozenAt) {
      held.set(key, { action, index });
    } else if (action.type === "set-field-value") {
      standing.set(key, { action, index });
    } else {
      standing.delete(key);
    }
  }
  // A held choice doesn't decide yet: the choice before the freeze still does.
  const standingChoice = choice?.state === "held" ? choice.standing : choice;
  const corrections: CorrectionReport[] = [];
  for (const [map, isHeld] of [
    [standing, false],
    [held, true],
  ] as const) {
    for (const { action, index } of map.values()) {
      const on = entrantEntries.find((e) => e.id === action.entryId);
      if (!on || on.id === undefined) continue;
      const original = on.values[action.fieldId] ?? null;
      corrections.push({
        actionIndex: givenIndex[index] ?? index,
        entryId: on.id,
        fieldId: action.fieldId,
        value: action.type === "set-field-value" ? action.value : original,
        original,
        state: isHeld
          ? "held"
          : on.id === counting.id
            ? "applied"
            : standingChoice?.state === "applied"
              ? "not-counting"
              : "superseded",
      });
    }
  }
  corrections.sort((a, b) => a.actionIndex - b.actionIndex);
  const judges = new Set(
    entrantEntries.flatMap((e) => (e.judgeId === undefined ? [] : [e.judgeId])),
  );
  const conflicted = judges.size > 1;
  const conflict: EntryReport["conflict"] = !conflicted
    ? "none"
    : standingChoice?.state === "applied"
      ? "resolved"
      : standingChoice?.state === "reopened"
        ? "reopened"
        : "unresolved";
  return {
    ...(counting.id !== undefined && { entryId: counting.id }),
    values,
    corrections,
    conflict,
    ...overrideReports(mine, frozenAt, givenIndex),
    ...(choice && {
      choice: {
        actionIndex: givenIndex[choice.index] ?? choice.index,
        entryId: choice.entryId,
        state: choice.state,
      },
    }),
  };
}

/**
 * The effective `set-final-rank`, `adjust-points` and per-Activity `disqualify` for one entrant: the latest
 * of each type, "held" when it was logged after the `finalize` freezing the Activity (the one before the
 * freeze still decides the result, so the held one is reported in its place).
 */
function overrideReports(
  mine: readonly { action: OfficialAction; index: number }[],
  frozenAt: number | undefined,
  givenIndex: readonly number[],
): Pick<EntryReport, "rankOverride" | "adjustment" | "dq"> {
  const state = (index: number): "applied" | "held" =>
    frozenAt !== undefined && index > frozenAt ? "held" : "applied";
  const last = <T extends OfficialAction["type"]>(type: T) => {
    const found = mine.findLast(({ action }) => action.type === type);
    return found && { action: found.action as ActionOf<T>, index: found.index };
  };
  const rank = last("set-final-rank");
  const adjust = last("adjust-points");
  const dq = last("disqualify");
  return {
    ...(rank && {
      rankOverride: {
        actionIndex: givenIndex[rank.index] ?? rank.index,
        rank: rank.action.rank,
        state: state(rank.index),
      },
    }),
    ...(adjust && {
      adjustment: {
        actionIndex: givenIndex[adjust.index] ?? adjust.index,
        points: adjust.action.points,
        state: state(adjust.index),
      },
    }),
    ...(dq && {
      dq: {
        actionIndex: givenIndex[dq.index] ?? dq.index,
        disqualified: dq.action.disqualified,
        state: state(dq.index),
      },
    }),
  };
}

/** An entrant's latest `choose-entry` at an Activity and what became of it. */
interface Choice {
  index: number;
  entryId: string;
  state: "applied" | "reopened" | "held";
  /** For a held choice: the latest choice before the freeze, which still decides. */
  standing?: Choice | undefined;
}

/**
 * Which entry counts for one entrant at one Activity, and the choice behind it. The newest counts unless
 * the latest standing `choose-entry` names another entry and that choice's `newestEntryId` is still the
 * newest; then the choice is reopened and the newest counts. A choice logged after the freeze is held:
 * the choice before it, if any, still decides (ADR-0019 2026-11-10).
 */
function counting(
  entrantEntries: readonly ScoreEntry[],
  mine: readonly { action: OfficialAction; index: number }[],
  frozenAt: number | undefined,
): { entry: ScoreEntry; choice: Choice | undefined } {
  const newest = entrantEntries[entrantEntries.length - 1];
  if (!newest) throw new Error("an entrant with no entries");
  const choices = mine.flatMap(({ action, index }) =>
    action.type === "choose-entry" ? [{ action, index }] : [],
  );
  const standing = choices.filter(
    ({ index }) => frozenAt === undefined || index < frozenAt,
  );
  const decide = (
    c: { action: ActionOf<"choose-entry">; index: number } | undefined,
  ): { entry: ScoreEntry; choice: Choice | undefined } => {
    if (!c) return { entry: newest, choice: undefined };
    const chosen = entrantEntries.find((e) => e.id === c.action.entryId);
    if (!chosen) return { entry: newest, choice: undefined };
    const stale = c.action.newestEntryId !== newest.id;
    return {
      entry: stale ? newest : chosen,
      choice: {
        index: c.index,
        entryId: c.action.entryId,
        state: stale ? "reopened" : "applied",
      },
    };
  };
  const decided = decide(standing.at(-1));
  const latestHeld = choices.at(-1);
  if (latestHeld && !standing.includes(latestHeld)) {
    return {
      entry: decided.entry,
      choice: {
        index: latestHeld.index,
        entryId: latestHeld.action.entryId,
        state: "held",
        standing: decided.choice,
      },
    };
  }
  return decided;
}

/** Scores a whole Event. Pure: the same input always gives the same results (ADR-0019). */
export function scoreEvent(given: ScoringInput): EventResults {
  const checked = validActions(given);
  const input = { ...given, actions: checked.actions };
  const givenIndex = checked.givenIndex;
  const activityById = new Map(input.activities.map((a) => [a.id, a]));
  const ranking = rankingFor(input.event.tieNumbering);
  const competitionById = new Map(
    input.event.competitions.map((c) => [c.id, c]),
  );

  const finalization = finalizations(input);
  const finalized = finalization.finalized;
  const warnings: ScoringWarning[] = [
    ...checked.warnings,
    ...finalization.warnings,
  ];
  const activities: ActivityResults[] = [];
  for (const { activityId, competitionId } of input.event.activities) {
    const activity = activityById.get(activityId);
    const competition = competitionById.get(competitionId);
    if (!activity) throw new Error(`Activity ${activityId} isn't given`);
    if (!competition)
      throw new Error(`Competition ${competitionId} isn't given`);
    const fields = mergeCommonFields(
      activity,
      competition,
      input.commonFieldSets,
    );
    // While finalized, actions logged after the `finalize` that would change this Activity wait for
    // `unfinalize` (ADR-0019).
    const frozen = finalized.get(activityId);
    const forThisActivity = input.actions.flatMap((a, index) =>
      "activityId" in a && "entrantId" in a && a.activityId === activityId
        ? [{ action: a, index }]
        : [],
    );
    for (const { action, index } of forThisActivity) {
      if (frozen && index > frozen.index) {
        warnings.push({
          action,
          message: `${activity.slug} is finalized; this ${action.type} won't apply until it's unfinalized`,
        });
      }
    }
    const actionsFor = (entrantId: string): OfficialAction[] =>
      forThisActivity
        .filter(
          ({ action, index }) =>
            action.entrantId === entrantId && (!frozen || index < frozen.index),
        )
        .map(({ action }) => action);

    // Every entry for the Activity, in received order; per entrant the newest counts (ADR-0019, #42).
    const here = input.entries.filter((e) => e.activityId === activityId);
    const reports = new Map<string, EntryReport>();
    // Per entrant, the counting entry: the newest, or the one an Official chose. An Official's corrections
    // are laid over its values before listing and totalling.
    const entrantIds = newestEntries(here).map((e) => e.entrantId);
    const entries = entrantIds.map((entrantId) => {
      const theirs = here.filter((x) => x.entrantId === entrantId);
      const mine = forThisActivity.filter(
        ({ action }) => action.entrantId === entrantId,
      );
      const { entry: e, choice } = counting(theirs, mine, frozen?.index);
      const values = correctedValues(e, actionsFor(entrantId));
      reports.set(
        entrantId,
        entryReport(e, theirs, values, choice, mine, frozen?.index, givenIndex),
      );
      return { ...e, values };
    });
    const reportOf = (entrantId: string): EntryReport =>
      reports.get(entrantId) ?? NO_REPORT;
    warnings.push(...unreadablePrimaryTimes(activity, entries));
    const scored = listed(activity, entries).map((e) => {
      const actions = actionsFor(e.entrantId);
      // The latest adjust-points wins, like every action type; adjustments don't add up (ADR-0019).
      const adjustment = latest(actions, "adjust-points")?.points ?? 0;
      return {
        entrantId: e.entrantId,
        total: entryTotal(fields, e.values) + adjustment,
        actions,
        report: reportOf(e.entrantId),
      };
    });
    // DQ'd entries are removed before ranking, so everyone below moves up (ADR-0019).
    const isDisqualified = (actions: readonly OfficialAction[]): boolean =>
      latest(actions, "disqualify")?.disqualified === true;
    const rankOf = ranking(
      scored.filter((e) => !isDisqualified(e.actions)).map((e) => e.total),
    );
    const recomputed = scored.map(
      ({ entrantId, total, actions, report }): EntryResult => {
        if (isDisqualified(actions)) {
          return { entrantId, total, points: 0, disqualified: true, ...report };
        }
        const provisionalRank = rankOf(total);
        const finalRank =
          latest(actions, "set-final-rank")?.rank ?? provisionalRank;
        return {
          entrantId,
          total,
          provisionalRank,
          finalRank,
          points:
            latest(actions, "set-placement-points")?.points ??
            placementPoints(
              finalRank,
              competition.placementPoints ?? DEFAULT_PLACEMENT_POINTS,
            ),
          disqualified: false,
          ...report,
        };
      },
    );
    if (!frozen) {
      activities.push({
        activityId,
        competitionId,
        finalized: false,
        entries: recomputed,
      });
      continue;
    }
    const stored = storedResults(frozen.action, scored, ranking, reportOf);
    const differ = differences(stored, recomputed);
    if (differ.length > 0) {
      warnings.push({
        action: frozen.action,
        message: `${activity.slug} is finalized, but recomputing from the current scores and actions would differ for ${differ.join(", ")}; the finalized ranking stands`,
      });
    }
    activities.push({
      activityId,
      competitionId,
      finalized: true,
      finalizedBy: { actionIndex: givenIndex[frozen.index] ?? frozen.index },
      entries: stored,
    });
  }

  const overallRanks = overallRankOverrides(input);
  const standings = input.event.competitions.map((c) =>
    competitionStandings(
      c.id,
      input,
      activityById,
      activities,
      ranking,
      overallRanks,
      givenIndex,
    ),
  );
  const awards = (input.event.awards ?? []).map((award) => ({
    awardId: award.id,
    recipients: awardRecipients(
      award,
      standings.find((s) => s.competitionId === award.competitionId)
        ?.entrants ?? [],
      input.actions,
    ),
  }));
  return {
    activities,
    standings,
    awards: awards.map(({ awardId, recipients }) => ({ awardId, recipients })),
    warnings,
  };
}

/**
 * The effective (latest) `set-overall-rank` per Competition and entrant, as `competitionId entrantId` → rank and its index in the (filtered) actions.
 * The actions are already checked by `validActions`.
 */
function overallRankOverrides(
  input: ScoringInput,
): ReadonlyMap<string, { rank: number; index: number }> {
  const ranks = new Map<string, { rank: number; index: number }>();
  input.actions.forEach((a, index) => {
    if (a.type === "set-overall-rank") {
      ranks.set(`${a.competitionId} ${a.entrantId}`, { rank: a.rank, index });
    }
  });
  return ranks;
}

/** Each entrant's sum of placement points over the Competition's ranked Activities, ranked by the Event's tie numbering. */
function competitionStandings(
  competitionId: string,
  input: ScoringInput,
  activityById: ReadonlyMap<string, Activity>,
  activities: readonly ActivityResults[],
  ranking: ReturnType<typeof rankingFor>,
  overallRanks: ReadonlyMap<string, { rank: number; index: number }>,
  givenIndex: readonly number[],
): CompetitionStandings {
  const ranked = activities.filter(
    (a) =>
      a.competitionId === competitionId &&
      activityById.get(a.activityId)?.scoringType === "ranked",
  );
  const totals = input.entrants
    .filter((e) => e.competitionId === competitionId)
    .map(({ id }) => ({
      entrantId: id,
      total: ranked.reduce(
        (sum, a) =>
          sum +
          a.entries
            .filter((e) => e.entrantId === id)
            .reduce((s, e) => s + e.points, 0),
        0,
      ),
    }));
  // An overall DQ is an action with no Activity; the latest one for the entrant wins.
  const dqOf = (entrantId: string) => {
    const index = input.actions.findLastIndex(
      (a) =>
        a.type === "disqualify" &&
        !("activityId" in a) &&
        a.entrantId === entrantId,
    );
    const action = input.actions[index];
    return action?.type === "disqualify"
      ? {
          actionIndex: givenIndex[index] ?? index,
          disqualified: action.disqualified,
          state: "applied" as const,
        }
      : undefined;
  };
  const isDisqualified = (entrantId: string): boolean =>
    dqOf(entrantId)?.disqualified === true;
  // DQ'd entrants keep their total but are removed before ranking (ADR-0019).
  const rankOf = ranking(
    totals.filter((t) => !isDisqualified(t.entrantId)).map((t) => t.total),
  );
  // An Official's override sets only that entrant's rank; nobody else is re-sorted. A DQ beats it.
  // Overall actions are never held by a finalize, so their state is always "applied".
  const reported = (entrantId: string) => {
    const dq = dqOf(entrantId);
    const override = overallRanks.get(`${competitionId} ${entrantId}`);
    return {
      ...(dq && { dq }),
      ...(override && {
        rankOverride: {
          actionIndex: givenIndex[override.index] ?? override.index,
          rank: override.rank,
          state: "applied" as const,
        },
      }),
    };
  };
  return {
    competitionId,
    entrants: totals.map((t): Standing =>
      isDisqualified(t.entrantId)
        ? { ...t, disqualified: true, ...reported(t.entrantId) }
        : {
            ...t,
            provisionalRank: rankOf(t.total),
            rank:
              overallRanks.get(`${competitionId} ${t.entrantId}`)?.rank ??
              rankOf(t.total),
            disqualified: false,
            ...reported(t.entrantId),
          },
    ),
  };
}

/**
 * An Activity's entries in listing order: by its primary metric's raw value in that metric's own
 * direction, entries with no value last; equal values keep entry order. Without a primary metric,
 * as entered. Listing only: ranking comes from points (ADR-0019 Measured Activities).
 */
function listed(
  activity: Activity,
  entries: readonly ScoreEntry[],
): readonly ScoreEntry[] {
  const primary = activity.scoring.fields.find((f) => f.primary);
  if (!primary?.primary) return entries;
  const sign = primary.primary.direction === "lower-wins" ? 1 : -1;
  const value = (e: ScoreEntry) => metricValue(primary, e.values[primary.id]);
  return [...entries].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === undefined || y === undefined) {
      return (x === undefined ? 1 : 0) - (y === undefined ? 1 : 0);
    }
    return sign * (x - y);
  });
}

/** A warning for each primary stopwatch time that was entered but can't be read, e.g. `"7.47"`. */
function unreadablePrimaryTimes(
  activity: Activity,
  entries: readonly ScoreEntry[],
): ScoringWarning[] {
  const primary = activity.scoring.fields.find((f) => f.primary);
  if (primary?.type !== "stopwatch") return [];
  return entries.flatMap((e) => {
    const value = e.values[primary.id];
    if (!unreadableStopwatch(value)) return [];
    return [
      {
        activityId: activity.id,
        entrantId: e.entrantId,
        fieldId: primary.id,
        value: value ?? null,
        message: `${activity.slug}, entrant ${e.entrantId}: "${String(value)}" isn't a stopwatch time (m:ss or h:mm:ss), so it's listed last`,
      },
    ];
  });
}

type Finalize = ActionOf<"finalize">;

/**
 * The Activities a `finalize` freezes, with its place in the log. Per Activity, only the latest
 * `finalize` or `unfinalize` is checked. An invalid latest `finalize` gets a warning and the Activity
 * stays frozen with the latest valid `finalize` since the last `unfinalize`, if there is one: finalized
 * results are what's printed on ribbons, and only an explicit `unfinalize` reopens (ADR-0019).
 */
function finalizations(input: ScoringInput): {
  finalized: ReadonlyMap<string, { action: Finalize; index: number }>;
  warnings: ScoringWarning[];
} {
  const logByActivity = new Map<
    string,
    { action: Finalize | ActionOf<"unfinalize">; index: number }[]
  >();
  input.actions.forEach((action, index) => {
    if (action.type === "finalize" || action.type === "unfinalize") {
      const log = logByActivity.get(action.activityId) ?? [];
      log.push({ action, index });
      logByActivity.set(action.activityId, log);
    }
  });
  const finalized = new Map<string, { action: Finalize; index: number }>();
  const warnings: ScoringWarning[] = [];
  for (const [activityId, log] of logByActivity) {
    const latestAction = log.at(-1)?.action;
    if (!latestAction) continue;
    // An `unfinalize` ends the loop below at once, so it's checked here; a `finalize` is checked in it.
    const unknown =
      latestAction.type === "unfinalize"
        ? actionProblem(input, latestAction)
        : undefined;
    if (unknown !== undefined) {
      warnings.push({ action: latestAction, message: unknown });
      continue;
    }
    for (const [i, { action, index }] of [...log.entries()].reverse()) {
      if (action.type === "unfinalize") break;
      const problem = actionProblem(input, action);
      if (!problem) {
        finalized.set(activityId, { action, index });
        break;
      }
      // Superseded invalid finalizes are skipped silently; only the latest one warns.
      if (i === log.length - 1) warnings.push({ action, message: problem });
    }
  }
  return { finalized, warnings };
}

/**
 * A `finalize` action's stored ranking as results, in its order. Totals stay live, and the Provisional
 * Ranking ranks them among the entrants it didn't DQ, as information; ranks and points are as stored.
 */
function storedResults(
  { ranking }: Finalize,
  scored: readonly { entrantId: string; total: number }[],
  rankingOf: ReturnType<typeof rankingFor>,
  reportOf: (entrantId: string) => EntryReport,
): EntryResult[] {
  const totalOf = (entrantId: string): number =>
    scored.find((s) => s.entrantId === entrantId)?.total ?? 0;
  const rankOf = rankingOf(
    ranking.filter((r) => !r.disqualified).map((r) => totalOf(r.entrantId)),
  );
  return ranking.map((r): EntryResult => {
    const total = totalOf(r.entrantId);
    if (r.disqualified) {
      return {
        entrantId: r.entrantId,
        total,
        points: 0,
        disqualified: true,
        ...reportOf(r.entrantId),
      };
    }
    return {
      entrantId: r.entrantId,
      total,
      provisionalRank: rankOf(total),
      finalRank: r.rank,
      points: r.points,
      disqualified: false,
      ...reportOf(r.entrantId),
    };
  });
}

/** Entrants whose rank, points or DQ differ between two sets of results, or who are in only one. */
function differences(
  a: readonly EntryResult[],
  b: readonly EntryResult[],
): string[] {
  const outcome = (r: EntryResult): string =>
    r.disqualified ? "DQ" : `${r.finalRank}:${r.points}`;
  const of = (results: readonly EntryResult[]) =>
    new Map(results.map((r) => [r.entrantId, outcome(r)]));
  const x = of(a);
  const y = of(b);
  return [...new Set([...x.keys(), ...y.keys()])]
    .filter((id) => x.get(id) !== y.get(id))
    .sort();
}
