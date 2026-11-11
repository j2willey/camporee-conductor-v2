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

const ORDINAL = /^\d+(st|nd|rd|th)$/i;

/** Who a sticker names: "Group Team" for a Team (just the Team with no Group), the Group, or "(unknown)". */
function stickerWho(entrant: AwardLine["entrant"]): string {
  if (entrant.team !== null) {
    return [entrant.group, entrant.team].filter((x) => x).join(" ");
  }
  return entrant.group ?? "(unknown)";
}

/**
 * A sticker's winner line, v1's shape (ADR-0027 "Award stickers"): "1st Place - Troop 101 Flaming Arrows";
 * "Gold Axe - …" for a named place, except an ordinal place name ("1st") reads "1st Place - …"; an Award with no
 * place or rank (Top Dog) reads "<Award title> - …". Display only.
 */
export function stickerWinnerLine(
  group: Pick<AwardGroup, "title">,
  line: AwardLine,
): string {
  const place =
    line.place !== undefined
      ? ORDINAL.test(line.place)
        ? `${line.place} Place`
        : line.place
      : line.rank !== undefined
        ? `${ordinal(line.rank)} Place`
        : group.title;
  return `${place} - ${stickerWho(line.entrant)}`;
}

/** A final Exhibition row on a sticker: "1st - Jane Doe, Troop 101 Owls"; the place as typed, left out when empty. */
export function stickerExhibitionLine(row: ExhibitionRow): string {
  const belongs = [row.group, row.team].filter((x) => x !== "").join(" ");
  const name =
    belongs === "" ? row.participantName : `${row.participantName}, ${belongs}`;
  return row.place === "" ? name : `${row.place} - ${name}`;
}

/** Stickers in rows across the sheet, in the order given (layout only; nothing is sorted). */
export function stickerRows<T>(items: readonly T[], perRow = 3): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += perRow) {
    rows.push(items.slice(i, i + perRow));
  }
  return rows;
}
