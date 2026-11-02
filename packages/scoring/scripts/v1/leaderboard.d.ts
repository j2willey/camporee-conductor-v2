import type { V1AppData } from "./types.d.ts";
/** { entity_id: { game_id: points } } */
export function calculateScoreContext(
  appData: V1AppData,
): Record<string, Record<string, number>>;
