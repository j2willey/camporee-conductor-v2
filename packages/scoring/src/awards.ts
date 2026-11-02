import type { Award } from "@camporee-conductor/schema";
import { withinCutoff } from "./ranking.ts";
import type { AwardRecipient, OfficialAction, Standing } from "./types.ts";

/**
 * Who receives an Award, from its Competition's standings and the Officials' `set-award` actions
 * (ADR-0019 Awards amendment). DQ'd entrants never receive an automatic award.
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
  const eligible = standings.filter((s) => !s.disqualified);
  const recipients = automatic(award.rule, eligible);

  // The latest set-award for each entrant wins.
  const decided = new Map<string, boolean>();
  for (const a of actions) {
    if (a.type === "set-award" && a.awardId === award.id) {
      decided.set(a.entrantId, a.awarded);
    }
  }
  const kept = recipients.filter((r) => decided.get(r.entrantId) !== false);
  const added = [...decided]
    .filter(
      ([entrantId, awarded]) =>
        awarded && !kept.some((r) => r.entrantId === entrantId),
    )
    .map(([entrantId]) => ({ entrantId, manual: true }));
  return [...kept, ...added];
}

/** The Award's rule applied to the entrants who aren't DQ'd, best first. */
function automatic(
  rule: Award["rule"],
  eligible: readonly Standing[],
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
      // A counted cutoff, so everyone tied at the line is included.
      const count = Math.ceil((rule.percent * eligible.length) / 100);
      return withinCutoff(eligible, count).map((s) => ({
        entrantId: s.entrantId,
        manual: false,
      }));
    }
    case "manual":
      return [];
  }
}
