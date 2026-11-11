import type { Award } from "@camporee-conductor/schema";
import { withinCutoff } from "./ranking.ts";
import type {
  AwardRecipient,
  OfficialAction,
  RankedStanding,
  Standing,
} from "./types.ts";

type SetAward = Extract<OfficialAction, { type: "set-award" }>;

/**
 * Who receives an Award, from its Competition's standings and the Officials' `set-award` actions
 * (ADR-0019 Awards amendment). DQ'd entrants never receive an automatic award. It takes only valid
 * actions: `scoreEvent` leaves an invalid `set-award` out with a warning, so the entrant keeps the automatic result.
 */
export function awardRecipients(
  award: Award,
  standings: readonly Standing[],
  actions: readonly OfficialAction[],
): AwardRecipient[] {
  if (award.scope === "division") {
    throw new Error(
      `Award ${award.slug}: Division-scoped awards aren't supported yet; they follow per-Division Activity ranking (#3)`,
    );
  }
  // DQ'd entrants were removed before the standings were ranked; they get no automatic award.
  const eligible = standings.filter(
    (s): s is RankedStanding => !s.disqualified,
  );
  const recipients = automatic(award.rule, eligible);

  // The latest set-award for each entrant wins. `scoreEvent` has already left out invalid ones.
  const latest = new Map<string, SetAward>();
  for (const a of actions) {
    if (a.type === "set-award" && a.awardId === award.id) {
      latest.set(a.entrantId, a);
    }
  }
  const decided = latest;
  const kept = recipients
    .filter((r) => decided.get(r.entrantId)?.awarded !== false)
    .map((r) => {
      // A logged place replaces the automatic one.
      const place = decided.get(r.entrantId)?.place;
      return place === undefined ? r : { ...r, place, manual: true };
    });
  const added = [...decided]
    .filter(
      ([entrantId, { awarded }]) =>
        awarded && !kept.some((r) => r.entrantId === entrantId),
    )
    .map(([entrantId, { place }]) =>
      place === undefined
        ? { entrantId, manual: true }
        : { entrantId, place, manual: true },
    );
  return [...kept, ...added];
}

/** The Award's rule applied to the entrants who aren't DQ'd, best first. */
function automatic(
  rule: Award["rule"],
  eligible: readonly RankedStanding[],
): AwardRecipient[] {
  switch (rule.type) {
    case "places":
      // By place number, not a count: ties share a name, and a skipped place has no recipient.
      return [...eligible]
        .sort((a, b) => a.rank - b.rank)
        .flatMap((s) => {
          const place = rule.names[s.rank - 1];
          return place === undefined
            ? []
            : [{ entrantId: s.entrantId, place, manual: false }];
        });
    case "top-percent": {
      // A counted cutoff, so everyone tied at the line is included. The count takes every entrant, no-shows too,
      // but an entrant with 0 points never gets it automatically (Awards amendment 2026-11-11, v1's Top Dog).
      const count = Math.ceil((rule.percent * eligible.length) / 100);
      return withinCutoff(eligible, count)
        .filter((s) => s.total > 0)
        .map((s) => ({ entrantId: s.entrantId, manual: false }));
    }
    case "manual":
      return [];
  }
}
