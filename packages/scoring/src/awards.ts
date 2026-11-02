import type { Award } from "@camporee-conductor/schema";
import { withinCutoff } from "./ranking.ts";
import type {
  AwardRecipient,
  OfficialAction,
  RankedStanding,
  Standing,
} from "./types.ts";

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
  // DQ'd entrants were removed before the standings were ranked; they get no automatic award.
  const eligible = standings.filter(
    (s): s is RankedStanding => !s.disqualified,
  );
  const recipients = automatic(award.rule, eligible);

  // The latest set-award for each entrant wins. Every logged place is checked, superseded or not.
  const decided = new Map<string, { awarded: boolean; place?: string }>();
  for (const a of actions) {
    if (a.type !== "set-award" || a.awardId !== award.id) continue;
    if (a.place !== undefined) checkPlace(award, a.place);
    decided.set(
      a.entrantId,
      a.place === undefined
        ? { awarded: a.awarded }
        : { awarded: a.awarded, place: a.place },
    );
  }
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

/** A `set-award` place must be one of a named-places Award's names. */
function checkPlace(award: Award, place: string): void {
  if (award.rule.type !== "places") {
    throw new Error(
      `set-award gives place "${place}" for Award ${award.slug}, but only a named-places Award takes a place`,
    );
  }
  if (!award.rule.names.includes(place)) {
    throw new Error(
      `"${place}" isn't a place of Award ${award.slug} (${award.rule.names.join(", ")})`,
    );
  }
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
