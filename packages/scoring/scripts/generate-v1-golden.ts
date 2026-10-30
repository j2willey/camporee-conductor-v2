/** Regenerates fixtures/circus-2026-results/v1-golden.json from v1's code (see v1-golden.ts). */
import { writeFileSync } from "node:fs";
import { buildV1Golden, GOLDEN_FILE } from "./v1-golden.ts";

const golden = buildV1Golden();
writeFileSync(GOLDEN_FILE, `${JSON.stringify(golden, null, 2)}\n`);
const c = golden.comparisons;
console.log(
  `wrote ${golden.games.length} games, ${golden.overall.length} overall standings`,
);
console.log(
  `official.js vs leaderboard.js point differences: ${c.leaderboardPointsVsOfficial.length}`,
);
console.log(
  `announcer sheet differs in: ${c.announcerVsOfficial.map((d) => d.gameId).join(", ") || "none"}`,
);
console.log(
  `overall changes if summed from official.js points: ${c.overallFromOfficialPoints.length}`,
);
