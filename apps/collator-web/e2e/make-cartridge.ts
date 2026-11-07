// Writes the Circus 2026 event-day cartridge to the path given, for the e2e test's Collator to load.
import { writeFileSync } from "node:fs";
import { circusCartridge } from "../../collator/src/test-support.ts";

const [path] = process.argv.slice(2);
if (!path) throw new Error("usage: make-cartridge <out.zip>");
writeFileSync(path, circusCartridge());
