import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";

// #40 PR 2: a Judge with no account scores a newly added Patrol at Clown Car; a resend after a lost reply
// doesn't duplicate the score; adding the same Patrol again is caught by the name warning.
// #40 PR 3: an Official listed in the cartridge sees that score ranked; an unlisted email is refused.
// Each test uses what the one before it stored, so they run in order.
test.describe.configure({ mode: "serial" });

const DB = resolve(import.meta.dirname, "../test-results/judge.db");
const count = (table: string) => {
  const db = new Database(DB, { readonly: true });
  try {
    return (
      db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }
    ).n;
  } finally {
    db.close();
  }
};

async function startJudging(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Who's judging?" }),
  ).toBeVisible();
  await page.getByLabel("Name").fill("Alex Judge");
  await page.getByLabel("Email").fill("alex@example.com");
  await page.getByRole("button", { name: "Start judging" }).click();
  await page.getByRole("button", { name: "Clown Car" }).click();
}

test("a Judge adds a Patrol, scores it, and a resend after a lost reply isn't counted twice", async ({
  page,
}) => {
  await startJudging(page);
  await expect(page.getByText("No Patrols on the list yet.")).toBeVisible();
  await page
    .getByRole("button", { name: "Patrol not listed? Add one" })
    .click();
  await page.getByLabel("New Troop name").fill("Troop 101");
  await page.getByLabel("Patrol name").fill("Flaming Arrows");

  // Adding is safe to resend too: the box saves the Patrol, but the phone never hears back.
  let teamReplyLost = false;
  await page.route("**/api/teams/*", async (route) => {
    if (teamReplyLost) return route.continue();
    teamReplyLost = true;
    await route.fetch();
    await route.fulfill({ status: 503, json: { error: "no answer" } });
  });
  await page.getByRole("button", { name: "Add Patrol" }).click();
  await expect(page.getByRole("alert")).toContainText("Not saved");
  await page.getByRole("button", { name: "Try again" }).click();

  await expect(
    page.getByRole("heading", { name: "Flaming Arrows (Troop 101)" }),
  ).toBeVisible();
  // Common Fields are on the form, with Clown Car's {{ten_essentials}} filled in.
  await expect(page.getByLabel("10 Essentials: Buddy")).toBeVisible();
  await page.getByLabel("Big Top Cruiser Clowns").fill("7");
  await page.getByLabel("Patrol Flag").fill("5");
  expect(count("groups")).toBe(1);
  expect(count("teams")).toBe(1);

  // When the box refuses an entry, resending it can't help: the form opens again to fix it.
  await page.route(
    "**/api/scores/*",
    (route) =>
      route.fulfill({ status: 400, json: { error: "Patrol Flag is wrong" } }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "Save score" }).click();
  await expect(page.getByRole("alert")).toContainText("Patrol Flag is wrong");
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(page.getByLabel("Patrol Flag")).toBeEnabled();
  expect(count("score_entries")).toBe(0);

  // The box stores the first send, but the phone never hears back.
  let lost = false;
  await page.route("**/api/scores/*", async (route) => {
    if (lost) return route.continue();
    lost = true;
    await route.fetch();
    await route.fulfill({ status: 503, json: { error: "no answer" } });
  });
  await page.getByRole("button", { name: "Save score" }).click();
  await expect(page.getByRole("alert")).toContainText("Not saved");
  await expect(page.getByLabel("Big Top Cruiser Clowns")).toHaveValue("7");

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Score saved: Flaming Arrows (Troop 101) at Clown Car. (The box already had it.)",
  );
  expect(count("score_entries")).toBe(1);
});

test("adding a Patrol that's already listed warns and offers the existing one", async ({
  page,
}) => {
  await startJudging(page);
  // The default path: it's listed, so pick it.
  await expect(
    page.getByRole("button", { name: "Flaming Arrows (Troop 101)" }),
  ).toBeVisible();

  // A Judge who adds it anyway, typed a little differently, is warned.
  await page
    .getByRole("button", { name: "Patrol not listed? Add one" })
    .click();
  await page.getByRole("combobox").selectOption({ label: "New Troop…" });
  await page.getByLabel("New Troop name").fill("101");
  await expect(page.getByRole("alert")).toContainText(
    "Troop 101 is already on the list.",
  );
  await page.getByRole("button", { name: "Use Troop 101" }).click();
  await page.getByLabel("Patrol name").fill("flaming  arrows");
  await expect(page.getByRole("alert")).toContainText(
    "Flaming Arrows is already in Troop 101",
  );
  await page
    .getByRole("button", { name: "Score Flaming Arrows (Troop 101)" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Flaming Arrows (Troop 101)" }),
  ).toBeVisible();
  expect(count("teams")).toBe(1);
  expect(count("groups")).toBe(1);
});

test("an Official on the cartridge's list sees the score ranked; an unlisted email is refused", async ({
  page,
}) => {
  await page.goto("/official");
  await expect(page.getByRole("heading", { name: "Officials" })).toBeVisible();

  // A Judge's email isn't an Official's: the gate refuses it (ADR-0027 item 5).
  await page.getByLabel("Email").fill("alex@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "alex@example.com isn't on this Event's list of Officials.",
  );
  await expect(page.getByRole("heading", { name: "Activities" })).toHaveCount(
    0,
  );

  // Listed in the event-day cartridge (apps/collator/src/test-support.ts); case doesn't matter.
  await page.getByLabel("Email").fill("Lead.Judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Activities" })).toBeVisible();
  await page.getByRole("button", { name: /Clown Car/ }).click();

  await expect(page.getByRole("heading", { name: "Clown Car" })).toBeVisible();
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows).toHaveCount(2);
  // 7 clowns + 5 for the flag + Midway Mite's default 6, totalled by packages/scoring.
  await expect(rows.nth(1).getByRole("cell")).toHaveText([
    "1st",
    "Flaming Arrows (Troop 101)",
    "18",
  ]);
  await expect(
    page.getByRole("columnheader", { name: "Patrol" }),
  ).toBeVisible();
  // The raw entry, with the Judge's name and the values as entered.
  await expect(page.getByText("from Alex Judge")).toBeVisible();
  await expect(page.getByText("Big Top Cruiser Clowns")).toBeVisible();

  // The email is kept on this device: a reload stays signed in, checked again by the box.
  await page.reload();
  await expect(page.getByText("Signed in as")).toContainText(
    "lead.judge@example.com",
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Officials" })).toBeVisible();
});
