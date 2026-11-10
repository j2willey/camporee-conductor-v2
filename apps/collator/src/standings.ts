import type { CheckedBundle } from "@camporee-conductor/cartridge";
import { scoreEvent, type Standing } from "@camporee-conductor/scoring";
import type { Db } from "./db/open.ts";
import {
  actedOnLog,
  entrantNamer,
  officialEvent,
  type Acted,
  type EntrantName,
} from "./official-view.ts";
import { loggedActions, scoringInput } from "./scoring-input.ts";

// Standings for Officials (#42 PR 4): each Competition's entrants ranked by packages/scoring. Standings are
// never finalized themselves; an Activity that isn't finalized counts as it stands, and is marked provisional
// (ADR-0019 2026-11-10).

export interface StandingsRow {
  entrantId: string;
  entrant: EntrantName;
  /** Scoring's rank (an Official's override applies); null when DQ'd overall. */
  rank: number | null;
  /** Rank by total before any Official override; null when DQ'd overall. */
  provisionalRank: number | null;
  total: number;
  disqualified: boolean;
  /** Placement points per ranked Activity of the Competition; null = no result there. */
  points: Record<string, number | null>;
  /** The effective overall DQ, with who and when; null with none, and for a reinstate (nothing to show). */
  dq: Acted | null;
  /** The effective `set-overall-rank`, with who and when. */
  rankOverride: (Acted & { rank: number }) | null;
}

export interface CompetitionStandingsView {
  competition: { id: string; label: string; level: "team" | "group" };
  /** The Competition's ranked Activities, in Event order. */
  activities: { id: string; title: string; finalized: boolean }[];
  rows: StandingsRow[];
  /** How many of `activities` an Official has finalized. */
  finalizedCount: number;
}

export function officialStandings(
  db: Db,
  bundle: CheckedBundle,
): CompetitionStandingsView[] {
  const logged = loggedActions(db);
  const results = scoreEvent(scoringInput(db, bundle, undefined, logged));
  const actedOn = actedOnLog(bundle, logged);
  const nameOf = entrantNamer(db);
  const listed = officialEvent(db, bundle).activities;
  const scoringType = new Map(
    bundle.activities.map((a) => [a.id, a.scoringType]),
  );
  return bundle.event.competitions.map((competition) => {
    const activities = listed
      .filter(
        (a) =>
          a.competition.id === competition.id &&
          scoringType.get(a.id) === "ranked",
      )
      .map(({ id, title, finalized }) => ({ id, title, finalized }));
    const pointsAt = new Map(
      results.activities.map((a) => [
        a.activityId,
        new Map(a.entries.map((e) => [e.entrantId, e.points])),
      ]),
    );
    const row = (s: Standing): StandingsRow => ({
      entrantId: s.entrantId,
      entrant: nameOf(s.entrantId),
      rank: s.disqualified ? null : s.rank,
      provisionalRank: s.disqualified ? null : s.provisionalRank,
      total: s.total,
      disqualified: s.disqualified,
      points: Object.fromEntries(
        activities.map((a) => [
          a.id,
          pointsAt.get(a.id)?.get(s.entrantId) ?? null,
        ]),
      ),
      // A reinstate that applies has nothing to show.
      dq: s.dq?.disqualified ? actedOn(s.dq.actionIndex) : null,
      rankOverride: s.rankOverride
        ? { ...actedOn(s.rankOverride.actionIndex), rank: s.rankOverride.rank }
        : null,
    });
    // Scoring lists standings in roster order, not rank order, so the box orders them for display: by rank
    // (an Official's override included; ties keep scoring's order), then the DQ'd rows. No score is recomputed.
    const rows = (
      results.standings.find((s) => s.competitionId === competition.id)
        ?.entrants ?? []
    )
      .map(row)
      .sort(
        (a, b) =>
          (a.rank ?? Number.POSITIVE_INFINITY) -
            (b.rank ?? Number.POSITIVE_INFINITY) || 0,
      );
    return {
      competition: {
        id: competition.id,
        label: competition.label,
        level: competition.level,
      },
      activities,
      rows,
      finalizedCount: activities.filter((a) => a.finalized).length,
    };
  });
}
