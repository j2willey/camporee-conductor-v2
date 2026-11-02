/**
 * Turns rows from a v1 Collator database into anonymized JSON fixtures (issue #3).
 *
 * The output keeps v1's own table and column names, so v1's ranking code can read it unchanged
 * when we generate golden results. Only what scoring needs is kept: entities, judges (renamed),
 * scores and game status. Everything else, including the `game_closures` audit log, is dropped.
 */

/** Replaces any free-text value, which can contain people's names. */
export const REDACTED = "[redacted]";

// --- v1 row shapes: v1's column names, not v2 vocabulary --------------------

export interface V1EntityRow {
  id: string;
  name: string;
  type: string;
  troop_number: string;
  parent_id: string | null;
  manual_rank: string | null;
}

export interface V1JudgeRow {
  id: number;
  name: string;
  email: string;
  unit: string | null;
}

export interface V1ScoreRow {
  uuid: string;
  game_id: string;
  entity_id: string;
  /** JSON text in the database. */
  score_payload: string;
  timestamp: number;
  judge_id: number | null;
}

export interface V1GameStatusRow {
  game_id: string;
  status: string | null;
}

export interface CollatorTables {
  entities: V1EntityRow[];
  judges: V1JudgeRow[];
  scores: V1ScoreRow[];
  gameStatus: V1GameStatusRow[];
}

/** A score with its payload parsed and its judge renumbered. */
export interface ExportedScore extends Omit<V1ScoreRow, "score_payload"> {
  score_payload: Record<string, unknown>;
}

export interface CollatorExport {
  entities: V1EntityRow[];
  judges: { id: number; name: string }[];
  scores: ExportedScore[];
  gameStatus: V1GameStatusRow[];
}

/** Looks up a field's v1 type (`number`, `textarea`…) for a game; undefined if not declared. */
export type FieldTypeOf = (
  gameId: string,
  fieldId: string,
) => string | undefined;

const FREE_TEXT_TYPES = new Set(["text", "textarea"]);

/** Keys the Official sets, which aren't declared as fields. */
const isOfficialKey = (key: string): boolean =>
  key === "manual_rank" || key === "manual_points" || key.endsWith("_pts");

const isNumeric = (value: string): boolean =>
  value.trim() !== "" && !Number.isNaN(Number(value));

function redactPayload(
  gameId: string,
  payload: Record<string, unknown>,
  fieldTypeOf: FieldTypeOf,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const type = fieldTypeOf(gameId, key);
    const freeText =
      typeof value === "string" &&
      value.trim() !== "" &&
      (type === undefined
        ? !isOfficialKey(key) && !isNumeric(value)
        : FREE_TEXT_TYPES.has(type));
    out[key] = freeText ? REDACTED : value;
  }
  return out;
}

const byKey =
  <T>(key: (item: T) => string | number) =>
  (a: T, b: T): number => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };

export function exportCollatorTables(
  tables: CollatorTables,
  fieldTypeOf: FieldTypeOf,
): CollatorExport {
  const judges = [...tables.judges].sort(byKey((j) => j.id));
  const judgeNumber = new Map(judges.map((j, i) => [j.id, i + 1]));

  const scores = [...tables.scores]
    .sort(byKey((s) => `${String(s.timestamp).padStart(16, "0")} ${s.uuid}`))
    .map((s) => ({
      ...s,
      judge_id:
        s.judge_id === null ? null : (judgeNumber.get(s.judge_id) ?? null),
      score_payload: redactPayload(
        s.game_id,
        JSON.parse(s.score_payload) as Record<string, unknown>,
        fieldTypeOf,
      ),
    }));

  return {
    entities: [...tables.entities].sort(byKey((e) => e.id)),
    judges: judges.map((_, i) => ({ id: i + 1, name: `Judge ${i + 1}` })),
    scores,
    gameStatus: [...tables.gameStatus].sort(byKey((g) => g.game_id)),
  };
}
