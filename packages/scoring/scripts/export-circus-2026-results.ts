/**
 * Exports the real Circus 2026 Collator database to anonymized JSON fixtures.
 *
 *   node scripts/export-circus-2026-results.ts <path/to/camporee.db>
 *
 * The database is opened read-only and is never committed. See collator-export.ts for what is kept.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  exportCollatorTables,
  type CollatorTables,
  type FieldTypeOf,
} from "./collator-export.ts";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error(
    "usage: node scripts/export-circus-2026-results.ts <camporee.db>",
  );
  process.exit(1);
}

// Field types come from the v1 cartridge, which declares every scored and recorded field.
const V1_SOURCE = new URL(
  "../../schema/fixtures/circus-2026/v1-source/",
  import.meta.url,
);
const OUT = new URL("../fixtures/circus-2026-results/", import.meta.url);

interface V1Field {
  id: string;
  type: string;
}
const readJson = <T>(url: URL): T => JSON.parse(readFileSync(url, "utf8")) as T;

const gameFields = new Map<string, Map<string, string>>();
for (const file of readdirSync(new URL("games/", V1_SOURCE))) {
  const game = readJson<{
    id: string;
    scoring_model: { inputs: V1Field[] };
  }>(new URL(`games/${file}`, V1_SOURCE));
  // v1 ids are used untrimmed: some have a trailing space, and scores are keyed by them.
  gameFields.set(
    game.id,
    new Map(game.scoring_model.inputs.map((f) => [f.id, f.type])),
  );
}
const presetFields = new Map(
  readJson<V1Field[]>(new URL("presets.json", V1_SOURCE)).map((f) => [
    f.id,
    f.type,
  ]),
);
const fieldTypeOf: FieldTypeOf = (gameId, fieldId) =>
  gameFields.get(gameId)?.get(fieldId) ?? presetFields.get(fieldId);

const db = new DatabaseSync(dbPath, { readOnly: true });
const all = <T>(sql: string): T[] => db.prepare(sql).all() as T[];
const tables: CollatorTables = {
  entities: all(
    "select id, name, type, troop_number, parent_id, manual_rank from entities",
  ),
  judges: all("select id, name, email, unit from judges"),
  scores: all(
    "select uuid, game_id, entity_id, score_payload, timestamp, judge_id from scores",
  ),
  gameStatus: all("select game_id, status from game_status"),
};
db.close();

const out = exportCollatorTables(tables, fieldTypeOf);
mkdirSync(OUT, { recursive: true });
const write = (name: string, rows: unknown): void => {
  writeFileSync(new URL(name, OUT), `${JSON.stringify(rows, null, 2)}\n`);
};
write("entities.json", out.entities);
write("judges.json", out.judges);
write("scores.json", out.scores);
write("game-status.json", out.gameStatus);
console.log(
  `wrote ${out.entities.length} entities, ${out.judges.length} judges, ${out.scores.length} scores, ${out.gameStatus.length} game statuses`,
);
