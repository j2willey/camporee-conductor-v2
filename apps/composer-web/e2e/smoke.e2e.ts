import { expect, test } from "@playwright/test";

// Issue #4: sign in → Organizations → pick one → Events → open Circus 2026 read-only.
test("an Organizer opens Circus 2026 read-only", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(
    page.getByRole("heading", { name: "Your Organizations" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Smoke Test" }).click();

  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
  await page
    .getByRole("link", { name: "Coyote Creek District Camporee 2026" })
    .click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Coyote Creek District Camporee 2026",
  );
  for (const competition of [
    "Patrol Games (18)",
    "Exhibition Events (4)",
    "Troop Challenges (11)",
  ]) {
    await expect(
      page.getByRole("heading", { name: competition }),
    ).toBeVisible();
  }
  // Nothing to type into until you ask to add an Activity (#6 PR 2b).
  await expect(page.locator("main").getByRole("textbox")).toHaveCount(0);

  // A reload of a deep link still works: the API sends the app for its own routes.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Coyote Creek District Camporee 2026",
  );
});

// Issue #5: the Event page opens its Program Guide, print-ready, in a new tab.
test("an Organizer opens the Program Guide in a new tab", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", { name: "Coyote Creek District Camporee 2026" })
    .click();

  const [guide] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Program Guide" }).click(),
  ]);
  await expect(guide).toHaveTitle(
    "Coyote Creek District Camporee 2026: Program Guide",
  );
  await expect(guide.getByRole("heading", { name: "Contents" })).toBeVisible();
  await expect(
    guide.getByText(/^DRAFT\s*\d+ sections to be supplied$/),
  ).toBeVisible();
  await expect(
    guide.getByText(
      "The Patrol Games will be announced closer to the Camporee.",
    ),
  ).toBeVisible();
});

// Issue #44: each Activity on the Event page opens its own guide in a new tab.
test("an Organizer opens one Activity's guide in a new tab", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", { name: "Coyote Creek District Camporee 2026" })
    .click();

  const [guide] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Guide for Clown Car" }).click(),
  ]);
  await expect(guide).toHaveTitle("Clown Car: guide");
  await expect(guide.getByText("The Judge's playbook")).toBeVisible();
});

// Issue #44 PR 2: the Guides page prints several guides, each starting on a right-hand page.
test("an Organizer prints Patrol Games guides two-sided", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", { name: "Coyote Creek District Camporee 2026" })
    .click();
  await page.getByRole("link", { name: "Guides", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Guides" })).toBeVisible();
  await expect(page.getByLabel("Two-sided", { exact: false })).toBeChecked();

  await page.getByRole("button", { name: "None of Troop Challenges" }).click();
  await page.getByRole("button", { name: "None of Exhibition Events" }).click();

  const [guides] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Open guides" }).click(),
  ]);
  await guides.waitForSelector('body[data-two-sided-ready="true"]');
  await expect(guides.locator("h1").first()).toHaveText(/^P1\. /);
  expect(await guides.locator("h1").count()).toBeGreaterThan(1);

  // Walk the printed pages: every guide must start on an odd page, counting the blank pages.
  const starts = await guides.evaluate(() => {
    let next = 1;
    const out: number[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el.matches("article")) {
        out.push(next);
        next += Number(el.getAttribute("data-pages"));
      } else if (el.matches(".blank-page")) next += 1;
    }
    return out;
  });
  expect(starts.length).toBeGreaterThan(1);
  for (const start of starts) expect(start % 2).toBe(1);

  // Issue #44 PR 3: the supplies list for the same picks, continuous by default.
  const [supplies] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Open supplies list" }).click(),
  ]);
  await expect(supplies).toHaveTitle(/: supplies list$/);
  await expect(supplies.locator("h2").first()).toHaveText(/^P1 /);
  await expect(supplies.locator("h2", { hasText: /^T\d+ / })).toHaveCount(0);
  await expect(supplies.locator("section.per-page")).toHaveCount(0);
});

test("not found replaces the whole page", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Your Organizations" }),
  ).toBeVisible();

  for (const path of ["/organizations/nope", "/events/nope", "/no-such-page"]) {
    await page.goto(path);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Events" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Not found",
    );
  }
});

// #6 PR 2b: an owner adds, duplicates, reorders, disables, moves and removes Activities. It runs last in this
// file and leaves the Event as it found it, so the tests above always see Circus 2026 as imported.
test("an owner edits the Activity list", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", { name: "Coyote Creek District Camporee 2026" })
    .click();
  const exhibitions = page.getByRole("region", { name: "Exhibition Events" });
  const challenges = page.getByRole("region", { name: "Troop Challenges" });
  const items = (region: typeof exhibitions) => region.getByRole("listitem");

  await page
    .getByRole("button", { name: "Add an Activity to Exhibition Events" })
    .click();
  await page
    .getByLabel("Title of the new Exhibition Events Activity")
    .fill("Tightrope Walk");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Exhibition Events (5)" }),
  ).toBeVisible();
  await expect(items(exhibitions).last()).toContainText("Tightrope Walk");

  await page.getByRole("button", { name: "Duplicate Tightrope Walk" }).click();
  await expect(items(exhibitions).last()).toContainText(
    "Tightrope Walk (copy)",
  );

  await page
    .getByRole("button", { name: "Move Tightrope Walk (copy) up" })
    .click();
  await expect(items(exhibitions).last()).toContainText("Tightrope Walk");
  await expect(items(exhibitions).last()).not.toContainText("(copy)");

  // click(), not uncheck(): the box follows the saved list a tick after the click.
  await page.getByLabel("Tightrope Walk (copy) enabled").click();
  await expect(
    page.getByLabel("Tightrope Walk (copy) enabled"),
  ).not.toBeChecked();
  await expect(
    items(exhibitions).filter({ hasText: "Tightrope Walk (copy)" }),
  ).toContainText("(disabled)");

  await page
    .getByLabel("Move Tightrope Walk (copy) to")
    .selectOption({ label: "Troop Challenges" });
  await expect(items(challenges).last()).toContainText("Tightrope Walk (copy)");
  await expect(
    page.getByRole("heading", { name: "Troop Challenges (12)" }),
  ).toBeVisible();

  // The changes are saved: a reload shows them.
  await page.reload();
  await expect(items(challenges).last()).toContainText("(disabled)");

  page.on("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", { name: "Remove Tightrope Walk (copy)" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Troop Challenges (11)" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove Tightrope Walk" }).click();
  await expect(
    page.getByRole("heading", { name: "Exhibition Events (4)" }),
  ).toBeVisible();
});

// #6 PR 3: an owner edits one Activity's text, is warned before leaving unsaved, saves, and sees it in the guide.
test("an owner edits an Activity and sees it in the guide", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", { name: "Coyote Creek District Camporee 2026" })
    .click();
  await page.getByRole("link", { name: "The Human Fly" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "The Human Fly",
  );
  await expect(page.getByRole("status")).toHaveText("All changes saved");

  await page
    .getByLabel("The Objective")
    .fill("Climb as high as you dare, then come down safely.");
  await page.getByRole("button", { name: "+ Add supply" }).click();
  await page.getByLabel("Item of supply 3").fill("Chalk bag");
  await page.getByLabel("Quantity of supply 3").fill("2");
  await expect(page.getByRole("status")).toHaveText("Unsaved changes");

  // Leaving with unsaved changes asks first; saying no stays on the page.
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("link", { name: "← Back to the Event" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "The Human Fly",
  );

  // An empty title can't be saved: the problem is named.
  await page.getByLabel("Title", { exact: true }).fill(" ");
  await expect(page.getByRole("alert")).toContainText("title");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await page.getByLabel("Title", { exact: true }).fill("The Human Fly");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved");

  const [guide] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Preview guide" }).click(),
  ]);
  await expect(
    guide.getByText("Climb as high as you dare, then come down safely."),
  ).toBeVisible();
  await expect(guide.getByText("Chalk bag")).toBeVisible();

  // Saved: a reload shows it, and leaving no longer asks.
  await page.reload();
  await expect(page.getByLabel("The Objective")).toHaveValue(
    "Climb as high as you dare, then come down safely.",
  );
  await page.getByRole("link", { name: "← Back to the Event" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Coyote Creek District Camporee 2026",
  );
});

// #6 PR 5: the scoring fields, and the judge's form preview with the Competition's Common Fields.
test("an owner edits scoring fields and tries the judge's form", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", { name: "Coyote Creek District Camporee 2026" })
    .click();
  await page.getByRole("link", { name: "Clown Car" }).click();

  const preview = page.getByRole("region", { name: "Judge's form" });
  // Common Fields before and after the Activity's own, with its variable filled in.
  await expect(preview.getByLabel("Patrol Flag")).toBeVisible();
  await expect(preview.getByText("10 Essentials: Buddy")).toBeVisible();
  await expect(preview.getByLabel("Judges Notes").last()).toBeVisible();

  // The judge's own checks: out of range is refused, in range is accepted.
  await preview.getByLabel("Big Top Cruiser Clowns").fill("12");
  await preview.getByRole("button", { name: "Check entry" }).click();
  await expect(preview.getByRole("alert")).toBeVisible();
  await preview.getByLabel("Big Top Cruiser Clowns").fill("3");
  await preview.getByRole("button", { name: "Check entry" }).click();
  await expect(preview.getByRole("status")).toContainText(
    "The Collator would accept this entry",
  );

  // A new field shows in the preview before saving, and is kept after.
  const scoring = page.getByRole("region", { name: "Scoring" });
  await scoring.getByRole("button", { name: "+ Add field" }).click();
  await scoring
    .getByLabel(/^Label of field \d+$/)
    .last()
    .fill("Ringmaster bonus");
  await expect(preview.getByLabel("Ringmaster bonus")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").last()).toHaveText("All changes saved");
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Judge's form" })
      .getByLabel("Ringmaster bonus"),
  ).toBeVisible();
});

// #6 PR 6: Competitions (Divisions, placement points) and Awards, saved with the Event.
test("an owner edits Competitions and Awards", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", { name: "Coyote Creek District Camporee 2026" })
    .click();
  await page.getByRole("link", { name: "Competitions and Awards" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Competitions and Awards",
  );

  // A Competition with Activities can't be removed.
  await page.getByRole("button", { name: "Remove Patrol Games" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Can't remove Patrol Games: It has 18 Activities.",
  );

  const exhibitions = page.getByRole("region", {
    name: "Competition: Exhibition Events",
  });
  await exhibitions
    .getByRole("button", { name: "Add a division to Exhibition Events" })
    .click();
  await exhibitions
    .getByLabel("Label of Exhibition Events division 1")
    .fill("Under 13");
  await exhibitions.getByLabel(/^Its own points/).check();
  await exhibitions.getByLabel(/^1st, 2nd, 3rd/).fill("10, 8, 6");

  await page.getByRole("button", { name: "+ Add award" }).click();
  await page.getByLabel("Name of award 3").fill("Gold Axe");
  await page
    .getByLabel("Competition of award 3")
    .selectOption({ label: "Troop Challenges" });
  await page
    .getByLabel("Rule of award 3")
    .selectOption({ label: "The top percent" });
  await page.getByLabel("Percent of award 3").fill("10");

  // A new, empty Competition comes and goes.
  await page.getByRole("button", { name: "+ Add Competition" }).click();
  await page.getByRole("button", { name: "Remove New Competition" }).click();

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved");

  await page.reload();
  await expect(
    page.getByLabel("Label of Exhibition Events division 1"),
  ).toHaveValue("Under 13");
  await expect(page.getByLabel(/^1st, 2nd, 3rd/)).toHaveValue("10, 8, 6");
  await expect(page.getByLabel("Name of award 3")).toHaveValue("Gold Axe");
  await expect(page.getByLabel("Percent of award 3")).toHaveValue("10");
  await expect(
    page.getByRole("region", { name: "Competition: New Competition" }),
  ).toHaveCount(0);
});
