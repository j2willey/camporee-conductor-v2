import type { CheckedBundle } from "@camporee-conductor/cartridge";
import {
  scoreEvent,
  winnersRegistry,
  type EventResults,
} from "@camporee-conductor/scoring";
import type { Db } from "./db/open.ts";
import { activityFields } from "./bundle-lookup.ts";
import {
  finalExhibitions,
  latestRows,
  type ExhibitionRow,
} from "./exhibition-results.ts";
import { entrantNamer } from "./official-view.ts";
import { loggedActions, scoringInput } from "./scoring-input.ts";

// The Awards page for Officials (#43 PR 1): the winners registry from packages/scoring, with names from the roster.
// The order is the registry's; nothing here ranks or sorts (CLAUDE.md rule 3).

export interface AwardLine {
  rank?: number;
  place?: string;
  entrantId: string;
  /** A Team's name and its Group's; a Group-level entrant has a Group and no Team; null names for an id off the roster. */
  entrant: { group: string | null; team: string | null };
  manual: boolean;
  /** Passed through from scoring (#43 PR 4): an Activity line's entry total, an Award line's standing total. */
  total?: number;
}

export interface ExhibitionAwardGroup {
  kind: "exhibition";
  id: string;
  title: string;
  /** The latest save's rows, in the Official's order; the place is as typed. */
  rows: ExhibitionRow[];
}

export interface AwardGroup {
  kind: "activity" | "award";
  id: string;
  /** The Activity's title or the Award's label. */
  title: string;
  lines: AwardLine[];
}

export interface AwardsView {
  /** True while any ranked Activity isn't finalized or any Exhibition is a draft: the places may change. */
  provisional: boolean;
  finalizedCount: number;
  rankedCount: number;
  exhibitionCount: number;
  exhibitionFinalCount: number;
  sections: {
    competition: { id: string; label: string };
    groups: (AwardGroup | ExhibitionAwardGroup)[];
  }[];
}

/** An Activity line's score: the entrant's entry `total` in that Activity's results. A lookup, nothing more. */
export function scoreOfActivityLine(
  results: EventResults,
  activityId: string,
  entrantId: string,
): number | undefined {
  return results.activities
    .find((a) => a.activityId === activityId)
    ?.entries.find((e) => e.entrantId === entrantId)?.total;
}

/** An Award line's score: the entrant's standing `total` (placement points) in the Award's Competition. */
export function scoreOfAwardLine(
  results: EventResults,
  competitionId: string,
  entrantId: string,
): number | undefined {
  return results.standings
    .find((s) => s.competitionId === competitionId)
    ?.entrants.find((e) => e.entrantId === entrantId)?.total;
}

export function officialAwards(db: Db, bundle: CheckedBundle): AwardsView {
  const results = scoreEvent(
    scoringInput(db, bundle, undefined, loggedActions(db)),
  );
  const registry = winnersRegistry(bundle.event, results, bundle.activities);
  const nameOf = entrantNamer(db);
  const titleOf = new Map<string, string>([
    ...bundle.activities.map((a) => [a.id, a.title] as const),
    ...(bundle.event.awards ?? []).map((a) => [a.id, a.label] as const),
  ]);
  const ranked = new Set(
    bundle.activities
      .filter((a) => a.scoringType === "ranked")
      .map((a) => a.id),
  );
  const rankedResults = results.activities.filter((a) =>
    ranked.has(a.activityId),
  );

  const sections: AwardsView["sections"] = [];
  for (const line of registry.lines) {
    const competition = bundle.event.competitions.find(
      (c) => c.id === line.competitionId,
    );
    if (!competition) continue;
    let section = sections.find((s) => s.competition.id === competition.id);
    if (!section) {
      section = {
        competition: { id: competition.id, label: competition.label },
        groups: [],
      };
      sections.push(section);
    }
    const id =
      (line.kind === "activity" ? line.activityId : line.awardId) ?? "";
    // Consecutive lines for the same Activity or Award make a group; the registry's order is kept.
    let group = section.groups.at(-1);
    if (
      !group ||
      group.kind === "exhibition" ||
      group.kind !== line.kind ||
      group.id !== id
    ) {
      group = { kind: line.kind, id, title: titleOf.get(id) ?? id, lines: [] };
      section.groups.push(group);
    }
    const name = nameOf(line.entrantId);
    const total =
      line.kind === "activity"
        ? scoreOfActivityLine(results, id, line.entrantId)
        : scoreOfAwardLine(results, competition.id, line.entrantId);
    group.lines.push({
      ...(line.rank !== undefined && { rank: line.rank }),
      ...(line.place !== undefined && { place: line.place }),
      entrantId: line.entrantId,
      entrant:
        competition.level === "team"
          ? { group: name.group, team: name.name }
          : { group: name.name, team: null },
      manual: line.manual,
      ...(total !== undefined && { total }),
    });
  }

  // Final Exhibitions, in the Event's Activity order, after each section's registry groups (CLAUDE.md rule 3).
  const finals = finalExhibitions(db);
  const exhibitions = bundle.activities.filter(
    (a) => a.scoringType === "exhibition",
  );
  const listed = exhibitions.filter((a) => finals.has(a.id));
  const sectionFor = (competitionId: string) => {
    let section = sections.find((s) => s.competition.id === competitionId);
    if (!section) {
      const c = bundle.event.competitions.find((c) => c.id === competitionId);
      if (!c) return undefined;
      section = {
        competition: { id: c.id, label: c.label },
        groups: [],
      };
      // Keep Competitions in the Event's order.
      const order = bundle.event.competitions.map((c) => c.id);
      const at = sections.findIndex(
        (s) => order.indexOf(s.competition.id) > order.indexOf(c.id),
      );
      sections.splice(at === -1 ? sections.length : at, 0, section);
    }
    return section;
  };
  for (const a of listed) {
    const competitionId = activityFields(bundle, a.id)?.competition.id;
    const rows = latestRows(db, a.id);
    // Final with nothing saved: no one to award, so nothing to list.
    if (competitionId === undefined || rows.length === 0) continue;
    sectionFor(competitionId)?.groups.push({
      kind: "exhibition",
      id: a.id,
      title: a.title,
      rows,
    });
  }
  return {
    provisional: registry.provisional || listed.length < exhibitions.length,
    finalizedCount: rankedResults.filter((a) => a.finalized).length,
    rankedCount: rankedResults.length,
    exhibitionCount: exhibitions.length,
    exhibitionFinalCount: listed.length,
    sections,
  };
}
