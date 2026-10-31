// Types for the parts of v1's JavaScript that v2 reads. v1 itself is untyped.

export interface V1Field {
  id: string;
  kind?: string;
  sortOrder?: number;
  [key: string]: unknown;
}

export interface V1Game {
  id: string;
  /** Event-day (schema 2.9) competition: "patrol", "troop" or "exhibition". */
  type?: string;
  name?: string;
  sortOrder: number;
  fields: V1Field[];
  [key: string]: unknown;
}

export interface V1Entity {
  id: string;
  name: string;
  type: string;
  troop_number: string;
  manual_rank: string | null;
}

/** A score as v1's /api/admin/all-data returned it to the browser. */
export interface V1Score {
  uuid: string;
  game_id: string;
  entity_id: string;
  timestamp: number;
  entity_name: string;
  troop_number: string;
  entity_type: string;
  score_payload: Record<string, unknown>;
}

export interface V1AppData {
  games: V1Game[];
  entities: V1Entity[];
  scores: V1Score[];
  commonScoring: V1Field[] | undefined;
  flags: { entity_id: string; game_id: string; dq?: boolean }[];
}
