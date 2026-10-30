// Regenerates json-schema/*.schema.json from the Zod schemas.
// Run: pnpm --filter @camporee-conductor/schema generate
import { mkdirSync, writeFileSync } from "node:fs";
import { buildJsonSchemas, JSON_SCHEMA_DIR } from "../src/json-schema.ts";

mkdirSync(JSON_SCHEMA_DIR, { recursive: true });
for (const [name, schema] of Object.entries(buildJsonSchemas())) {
  const file = new URL(`${name}.schema.json`, JSON_SCHEMA_DIR);
  writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`wrote ${file.pathname}`);
}
