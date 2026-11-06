// v1 cartridge shapes (schema 3.0), read from v1's code: the Composer's `exportCamporee` (the zip) and
// its server save (the workspace on disk, which is what fixtures/circus-2026/v1-source is). Only the
// parts the importer reads. Where the two differ, the field is optional.
import type { ScoringField } from "@camporee-conductor/schema";

/** A scoring input on a game, or a preset (a Common Field) in presets.json. */
export interface V1Input {
  id: string;
  label: string;
  type: ScoringField["type"];
  kind: ScoringField["kind"];
  audience: "judge" | "admin";
  /** Missing on some Composer-generated inputs; v1 used array position. */
  sortOrder?: number;
  weight: number;
  required?: boolean;
  config?: {
    min?: number;
    max?: number;
    placeholder?: string;
    defaultValue?: number | string | boolean;
    options?: string[];
  };
  /** Presets only. */
  tier?: string;
  position?: string;
}

export interface V1Game {
  id: string;
  league: string;
  /** The server workspace has these; the exported zip doesn't. */
  library_uuid?: string;
  library_title?: string;
  variables?: Record<string, string>;
  content: Record<string, string | string[] | undefined>;
  scoring_model: {
    method: "points_desc" | "timed_asc";
    inputs: V1Input[];
  };
  /** The workspace always writes it; the zip only when true. */
  bracketMode?: boolean;
  match_label?: string;
  session?: string | null;
  sortOrder?: number;
}

export interface V1League {
  id: string;
  label: string;
  tier: "unit" | "subunit";
  registration: "registered" | "open";
}

export interface V1Camporee {
  schemaVersion: string;
  meta: {
    title: string;
    theme: string;
    year: number;
    director: string;
    camporeeId: string;
    theme_colors: { main: string; header: string; accent: string };
    awards_config: {
      line1: string;
      line2: string;
      sync: boolean;
      styles: Record<
        "1" | "2" | "3" | "4",
        { font: string; size: string; bold: boolean }
      >;
    };
  };
  terminology: {
    unit: string;
    subunit: string;
    member: string;
    event: string;
    organizer?: string;
  };
  leagues: V1League[];
  type_defaults: Record<string, { prefix: string[]; suffix: string[] }>;
  /** The zip adds `enabled`; v1's Collator skips a game when it's false. */
  playlist: { gameId: string; order: number; enabled?: boolean }[];
  /** The zip includes the event's Officials (emails) when exported from the server. */
  officials?: {
    user_id?: string;
    display_name?: string | null;
    email?: string | null;
    /** "director" for the event's owner; anything else is an Official. */
    role?: string;
  }[];
  sessions?: unknown[];
  rosters?: unknown;
}

/** One v1 event, its files already parsed. */
export interface V1Cartridge {
  camporee: V1Camporee;
  presets: V1Input[];
  games: V1Game[];
  /** Files in the zip's assets/ folder, by name. v2 has no asset import yet (#7). */
  assetNames?: string[];
}
