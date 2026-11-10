import type { CheckedBundle } from "@camporee-conductor/cartridge";
import type { Db } from "./db/open.ts";
import { invalid, type Recorded } from "./roster-and-scores.ts";

// Exhibition results (ADR-0027, #42 PR 7). Stub: the tests come first.

export interface ExhibitionRow {
  participantName: string;
  group: string;
  team: string;
  place: string;
  notes: string;
}

export interface ExhibitionSaveSubmission {
  id: string;
  officialEmail: string;
  activityId: string;
  rows: ExhibitionRow[];
  replacesId: string | null;
  clientCreatedAt: string;
}

export interface ExhibitionResultsView {
  activity: {
    id: string;
    title: string;
    competition: { id: string; label: string; level: "team" | "group" };
  };
  rows: ExhibitionRow[];
  saveId: string | null;
  savedBy: string | null;
  savedAt: string | null;
  history: { saveId: string; by: string; at: string; rowCount: number }[];
}

export function recordExhibitionResults(
  _db: Db,
  _bundle: CheckedBundle,
  _submission: ExhibitionSaveSubmission,
): Recorded {
  return invalid("not built yet");
}

export function exhibitionResults(
  _db: Db,
  _bundle: CheckedBundle,
  _activityId: string,
): ExhibitionResultsView | undefined {
  return undefined;
}
