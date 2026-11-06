import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EventBundle } from "./import-event.ts";

/**
 * Reads an Event's documents from a cartridge-shaped directory: `event.json`, `common-fields.json`,
 * `activities/*.json` and, if present, `officials.json`. Other files (notes, v1 sources, overlay.json) are
 * ignored. Nothing is validated here.
 */
export function readEventBundle(dir: string): EventBundle {
  const read = (path: string): unknown =>
    JSON.parse(readFileSync(join(dir, path), "utf8"));
  return {
    event: read("event.json"),
    commonFieldSets: [read("common-fields.json")],
    activities: readdirSync(join(dir, "activities"))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => read(join("activities", f))),
    ...(existsSync(join(dir, "officials.json")) && {
      officials: read("officials.json"),
    }),
  };
}
