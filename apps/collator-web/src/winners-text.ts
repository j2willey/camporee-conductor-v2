import type {
  AwardGroup,
  AwardLine,
  ExhibitionRow,
} from "@camporee-conductor/collator/types";
import { ordinal } from "./format.ts";

// The words for a winners-registry line, in one place so award stickers (#43 PR 3) and the announcer script (PR 4)
// can reuse them. Display only: places and recipients come from packages/scoring.

/** "Team (Group)" for a Team, "Group" for a Group, and "(unknown)" for an id that isn't on the roster. */
export function winnerName(entrant: AwardLine["entrant"]): string {
  if (entrant.team !== null) {
    return entrant.group ? `${entrant.team} (${entrant.group})` : entrant.team;
  }
  return entrant.group ?? "(unknown)";
}

/** The place as said: the Award's place name, else "1st"; a line with no place (Top Dog) says the Award's title. */
export function winnerPlace(
  line: Pick<AwardLine, "rank" | "place">,
  title: string,
): string {
  if (line.place !== undefined) return line.place;
  return line.rank === undefined ? title : ordinal(line.rank);
}

/** One row: "1st  Team (Group)", "Top Dog  Group", with "(Official)" on an Official's own choice. */
export function winnerRow(group: Pick<AwardGroup, "title">, line: AwardLine) {
  return {
    place: winnerPlace(line, group.title),
    name: winnerName(line.entrant),
    official: line.manual,
  };
}

/** "Provisional: 3 of 20 Activities and 1 of 2 Exhibitions final. Awards may change." or "All Activities and Exhibitions final." */
export function provisionalBanner(view: {
  provisional: boolean;
  finalizedCount: number;
  rankedCount: number;
  exhibitionCount: number;
  exhibitionFinalCount: number;
}): string {
  const hasExhibitions = view.exhibitionCount > 0;
  if (!view.provisional) {
    return hasExhibitions
      ? "All Activities and Exhibitions final."
      : "All Activities final.";
  }
  const exhibitions = hasExhibitions
    ? ` and ${view.exhibitionFinalCount} of ${view.exhibitionCount} Exhibitions`
    : "";
  return `Provisional: ${view.finalizedCount} of ${view.rankedCount} Activities${exhibitions} final. Awards may change.`;
}

/** One final Exhibition row: the place as the Official typed it, the name, "Group / Team" when given, and notes. */
export function exhibitionRowText(row: ExhibitionRow) {
  return {
    place: row.place === "" ? "—" : row.place,
    name: row.participantName,
    belongs: [row.group, row.team].filter((x) => x !== "").join(" / "),
    notes: row.notes,
  };
}
