// Seeds the demo Collator's roster with invented Groups and Teams, so the judge page isn't empty (#143).
//   node deploy/demo/seed-roster.ts <collator-url>     e.g. https://collator-demo.camporeeconductor.com
// Uses the judge page's own roster API (PUT by id), so running it again changes nothing. Names are made up: rosters
// are personal data (ADR-0026) and never come from a real Event.

const GROUPS: Record<string, string[]> = {
  "Troop 101": ["Lions", "Tigers", "Bears"],
  "Troop 202": ["Hawks", "Falcons", "Owls"],
  "Troop 303": ["Foxes", "Wolves"],
  "Troop 404": ["Comets", "Rockets", "Meteors"],
};

const base = process.argv[2]?.replace(/\/$/, "");
if (!base?.startsWith("http")) {
  throw new Error("usage: seed-roster <collator-url>");
}

async function put(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${base}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PUT ${path}: ${res.status} ${await res.text()}`);
  }
}

const slug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

let teams = 0;
for (const [group, teamNames] of Object.entries(GROUPS)) {
  const groupId = `demo-${slug(group)}`;
  await put(`/api/groups/${groupId}`, { name: group });
  for (const team of teamNames) {
    await put(`/api/teams/${groupId}-${slug(team)}`, { groupId, name: team });
    teams += 1;
  }
}
console.log(
  `seeded ${Object.keys(GROUPS).length} Groups and ${teams} Teams at ${base}`,
);
