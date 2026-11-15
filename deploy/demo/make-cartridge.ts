// Writes the demo's event-day cartridge: the Circus 2026 design with the demo's Officials (#143).
//   node deploy/demo/make-cartridge.ts <director-email> <out.zip>
// The Director's email is given on the command line, so it never lands in this public repo. The demo Official's
// email is printed on the demo hub, so it has the plain Official role: a Director can load a different cartridge
// over the internet, an Official can't.
import { writeFileSync } from "node:fs";
// deploy/demo is not a workspace package, so the cartridge package is imported by path.
import { exportCartridge } from "../../packages/cartridge/src/index.ts";
import { circusBundle } from "../../apps/collator/src/test-support.ts";

export const DEMO_OFFICIAL_EMAIL = "demo@camporeeconductor.com";

const [director, out] = process.argv.slice(2);
if (!director?.includes("@") || !out) {
  throw new Error("usage: make-cartridge <director-email> <out.zip>");
}

const bundle = circusBundle();
bundle.officials = {
  ...bundle.officials,
  officials: [
    { email: director, name: "Demo Director", role: "director" },
    { email: DEMO_OFFICIAL_EMAIL, name: "Demo Official", role: "official" },
  ],
};
writeFileSync(
  out,
  exportCartridge(bundle, "event-day", { exportedAt: new Date() }),
);
console.log(
  `wrote ${out}: Circus 2026, Director ${director}, Official ${DEMO_OFFICIAL_EMAIL}`,
);
