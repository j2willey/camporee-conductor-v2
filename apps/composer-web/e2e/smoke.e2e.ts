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

// #102 PR 2: the Library page, from the header. The smoke database has no Templates or saved Activities yet
// (an Event's own Activities aren't listed), so this checks the empty state and the filters.
test("an Organizer opens the Library", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Library" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(page.getByText(/^Nothing here yet/)).toBeVisible();

  await page.getByRole("button", { name: "Activities" }).click();
  await expect(
    page.getByRole("button", { name: "Activities" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Search").fill("clown");
  await expect(page.getByText("Nothing matches these filters.")).toBeVisible();
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

// #6 PR 7: the Event's details, theme colors with v1's "reset to defaults", saved with the Event.
test("an owner edits the Event details", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", { name: "Coyote Creek District Camporee 2026" })
    .click();
  await page.getByRole("link", { name: "Event details" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Event details",
  );
  await expect(page.getByLabel("Theme", { exact: true })).toHaveValue(
    "The Circus",
  );

  // Ends before it starts: named, and Save stays off.
  await page.getByLabel("Starts").fill("2027-05-16");
  await page.getByLabel("Ends").fill("2027-05-14");
  await expect(page.getByRole("alert")).toContainText("endDate");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await page.getByLabel("Starts").fill("2027-05-14");
  await page.getByLabel("Ends").fill("2027-05-16");

  await page.getByLabel("Theme", { exact: true }).fill("Under the Big Top");
  await page.getByLabel("Year").fill("2027");
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(page.getByLabel("Main color", { exact: true })).toHaveValue(
    "#0d6efd",
  );
  await page.getByRole("button", { name: "+ Add skill" }).click();
  await page.getByLabel("skill 13", { exact: true }).fill("Knots");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved");
  await page.reload();
  await expect(page.getByLabel("Theme", { exact: true })).toHaveValue(
    "Under the Big Top",
  );
  await expect(page.getByLabel("Ends")).toHaveValue("2027-05-16");
  await expect(page.getByLabel("Header color", { exact: true })).toHaveValue(
    "#34495e",
  );
  await expect(page.getByLabel("skill 13", { exact: true })).toHaveValue(
    "Knots",
  );
});

// #6 PR 8: venue, introduction and contacts, and the Program Guide using them.
test("an owner adds the venue, introduction and a contact", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", { name: "Coyote Creek District Camporee 2026" })
    .click();
  await page.getByRole("link", { name: "Event details" }).click();

  await page.getByLabel("Venue", { exact: true }).fill("Camp Chesebrough");
  await page.getByLabel(/^Introduction/).fill("Welcome to the **Big Top**!");
  await page.getByRole("button", { name: "+ Add contact" }).click();
  await page.getByLabel("Role of contact 1").fill("Camporee Director");
  await page.getByLabel("Name of contact 1").fill("Pat Example");
  await page.getByLabel("Email of contact 1").fill("pat@example.com");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved");

  await page.reload();
  await expect(page.getByLabel("Name of contact 1")).toHaveValue("Pat Example");

  await page.getByRole("link", { name: "← Back to the Event" }).click();
  const [guide] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Program Guide" }).click(),
  ]);
  await expect(guide.getByText("Camp Chesebrough")).toBeVisible();
  await expect(guide.locator("strong", { hasText: "Big Top" })).toBeVisible();
});

// #99 PR 2: the Event's Common Fields, and each Competition's picks, saved with the Event.
test("an owner edits Common Fields and picks them for a Competition", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", { name: "Coyote Creek District Camporee 2026" })
    .click();
  await page.getByRole("link", { name: "Common Fields" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Common Fields",
  );
  await expect(page.getByRole("list", { name: "Used by" })).toContainText(
    "Patrol Games: before: Patrol Flag, Patrol Yell",
  );

  // A field a Competition uses can't go: the page says which Competition, and won't save.
  const field = (label: string) =>
    page.getByRole("listitem", { name: new RegExp(`: ${label}`) });
  await field("10 Essentials")
    .getByRole("button", { name: /^Remove field/ })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Patrol Games uses ten_ess.",
  );
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await page.getByRole("button", { name: "Discard changes" }).click();

  // Variables filled from one Activity.
  await page
    .getByRole("region", { name: "Variables" })
    .getByLabel("Activity")
    .selectOption({ label: "Clown Car" });
  await expect(page.getByText("10 Essentials: Buddy")).toBeVisible();

  await field("Patrol Yell")
    .getByLabel(/^Label of field/)
    .fill("Patrol Cheer");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved");

  // Exhibition Events picks the renamed field, after its Activities' own.
  await page.getByRole("link", { name: "← Back to the Event" }).click();
  await page.getByRole("link", { name: "Competitions and Awards" }).click();
  const exhibitions = page.getByRole("region", {
    name: "Competition: Exhibition Events",
  });
  await exhibitions
    .getByLabel("Patrol Cheer in Exhibition Events")
    .selectOption("after");
  await expect(exhibitions.getByText("After each Activity's")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved");
  await page.reload();
  await expect(
    page.getByLabel("Patrol Cheer in Exhibition Events"),
  ).toHaveValue("after");
});

// #99 PR 3: a starter field becomes the Activity's own field, in the preview and after saving.
test("an owner adds a starter field to an Activity", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", { name: "Coyote Creek District Camporee 2026" })
    .click();
  await page.getByRole("link", { name: "The Human Fly" }).click();

  await page
    .getByRole("region", { name: "Scoring" })
    .getByLabel("Add a starter field")
    .selectOption({ label: "Judge's points (1–10)" });
  const preview = page.getByRole("region", { name: "Judge's form" });
  await expect(preview.getByLabel("Judge's points")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Scoring" })
      .getByLabel(/^Id of field/)
      .last(),
  ).toHaveValue("judge_points");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").last()).toHaveText("All changes saved");
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Judge's form" })
      .getByLabel("Judge's points"),
  ).toBeVisible();
});

// #100 PR 1: a new, empty Event, and a copy of Circus 2026. Last, since it adds Events to the list.
test("an owner starts a new Event and duplicates one", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();

  const form = page.getByRole("form", { name: "New Event" });
  await form.getByLabel("Name").fill("Spring Jamboree 2027");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Spring Jamboree 2027",
  );
  await expect(page.getByText("No Competitions yet.")).toBeVisible();

  // The same slug again is refused, naming the Event that has it.
  await page.goBack();
  await form.getByLabel("Name").fill("Spring Jamboree 2027");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form.getByRole("alert")).toContainText(
    "Spring Jamboree 2027 already uses the slug spring-jamboree-2027",
  );

  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", {
      name: "Duplicate Coyote Creek District Camporee 2026",
      exact: true,
    })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Coyote Creek District Camporee 2026 (copy)",
  );
  await expect(
    page.getByRole("heading", { name: "Patrol Games (18)" }),
  ).toBeVisible();
});

// #100 PR 2: the design cartridge downloads and imports back as an update; event-day says what's missing.
test("an owner downloads a cartridge and imports it again", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", {
      name: "Coyote Creek District Camporee 2026",
      exact: true,
    })
    .click();

  // The seeded Event has no Officials, so the event-day export says it needs a Director.
  await page
    .getByRole("button", { name: "Download event-day cartridge (for the box)" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "an event-day cartridge needs at least one Director",
  );

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download design cartridge" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(
    "coyote-creek-camporee-2026-design.zip",
  );
  const zip = await download.path();

  await page.getByRole("link", { name: "← Your Organizations" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  const form = page.getByRole("form", { name: "Import a cartridge" });
  await form.getByLabel("Zip file").setInputFiles(zip);
  await form.getByRole("button", { name: "Import" }).click();
  await expect(form.getByRole("status")).toContainText(
    "Imported Coyote Creek District Camporee 2026: 0 created",
  );

  // Not a zip: refused, naming the file.
  await form.getByLabel("Zip file").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await form.getByRole("button", { name: "Import" }).click();
  await expect(form.getByRole("alert")).toHaveText(
    "notes.txt: not a zip file, so neither a cartridge nor a v1 export",
  );
});

// #100 PR 3: one Activity out as a file, and into another Competition as a new Activity.
test("an owner exports an Activity and imports it elsewhere", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", {
      name: "Coyote Creek District Camporee 2026",
      exact: true,
    })
    .click();
  await page.getByRole("link", { name: "Clown Car" }).first().click();

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Activity" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("clown-car.activity.json");
  const file = await download.path();

  await page.getByRole("link", { name: "← Back to the Event" }).click();
  const exhibitions = page.getByRole("region", { name: "Exhibition Events" });
  await expect(
    exhibitions.getByRole("link", { name: "Clown Car" }),
  ).toHaveCount(0);
  await exhibitions
    .getByLabel("Import an Activity into Exhibition Events")
    .setInputFiles(file);
  await expect(
    exhibitions.getByRole("link", { name: "Clown Car" }),
  ).toBeVisible();

  // Not JSON: refused, naming the file.
  await exhibitions
    .getByLabel("Import an Activity into Exhibition Events")
    .setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });
  await expect(page.getByRole("alert")).toContainText(
    "notes.txt: not valid JSON",
  );
});

// #100 PR 4: the Officials editor; with a Director, the event-day cartridge downloads.
test("an owner adds a Director, then downloads the event-day cartridge", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", {
      name: "Coyote Creek District Camporee 2026",
      exact: true,
    })
    .click();
  await page.getByRole("link", { name: "Officials" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Officials");
  await expect(page.getByText("No Director yet.")).toBeVisible();

  await page.getByRole("button", { name: "+ Add Official" }).click();
  await page.getByLabel("Email of Official 1").fill("dana@example.com");
  await page.getByLabel("Name of Official 1").fill("Dana");
  await expect(page.getByLabel("Official 1 is a Director")).toBeChecked();
  await expect(page.getByText("No Director yet.")).toHaveCount(0);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved");
  await page.reload();
  await expect(page.getByLabel("Email of Official 1")).toHaveValue(
    "dana@example.com",
  );

  await page.getByRole("link", { name: "← Back to the Event" }).click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download event-day cartridge (for the box)" })
    .click();
  expect((await downloading).suggestedFilename()).toBe(
    "coyote-creek-camporee-2026-event-day.zip",
  );
});

// #101 PR 1: the members list; the last owner can't be demoted.
test("an owner sees the members and can't demote the last owner", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();

  const members = page.getByRole("region", { name: "Members" });
  const role = members.getByLabel("Role of smoke@example.com");
  await expect(role).toHaveValue("owner");
  await role.selectOption("editor");
  await expect(members.getByRole("alert")).toHaveText(
    "An Organization needs at least one owner.",
  );
  await expect(role).toHaveValue("owner");
});

// #101 PR 2 (#35): invite someone who hasn't signed in; their first sign-in makes them a member.
test("an owner invites someone, who becomes a member when they sign in", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();

  const members = page.getByRole("region", { name: "Members" });
  await members.getByLabel("Email").fill("newcomer@example.com");
  await members.getByLabel("Role of the new member").selectOption("editor");
  await members.getByRole("button", { name: "Add" }).click();
  await expect(members.getByRole("status")).toHaveText(
    "newcomer@example.com hasn't signed in yet: they'll be added as an editor when they sign in.",
  );
  const pending = members.getByRole("group", { name: "Pending invites" });
  await expect(pending).toContainText("newcomer@example.com");

  // Revoke and invite again, then they sign in elsewhere.
  await pending
    .getByRole("button", { name: "Revoke the invite for newcomer@example.com" })
    .click();
  await expect(pending).toHaveCount(0);
  await members.getByLabel("Email").fill("newcomer@example.com");
  await members.getByRole("button", { name: "Add" }).click();
  await expect(pending).toContainText("newcomer@example.com");

  const theirs = await browser.newContext();
  const them = await theirs.newPage();
  await them.goto("/");
  await them.getByLabel("Email").fill("newcomer@example.com");
  await them.getByRole("button", { name: "Sign in" }).click();
  await expect(them.getByRole("link", { name: "Smoke Test" })).toBeVisible();
  await theirs.close();

  await page.reload();
  await expect(page.getByLabel("Role of newcomer@example.com")).toHaveValue(
    "editor",
  );
  await expect(
    page.getByRole("group", { name: "Pending invites" }),
  ).toHaveCount(0);
});

// #102 PR 3: an Activity copied to the library, published, and added to another Competition as a copy. It runs last
// and puts the Event back as it was: the copy is removed, and the saved one is unpublished (it stays private).
test("an owner copies an Activity to the library and adds it elsewhere", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", {
      name: "Coyote Creek District Camporee 2026",
      exact: true,
    })
    .click();
  await page
    .getByRole("region", { name: "Patrol Games" })
    .getByRole("link", { name: "Clown Car" })
    .click();

  await page.getByRole("button", { name: "Copy to library" }).click();
  const copied = page.getByRole("status").filter({ hasText: "Copied" });
  await expect(copied).toHaveText("Copied to your library.");
  await copied.getByRole("link", { name: "library" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "Clown Car" });
  await expect(row).toContainText("Private");

  // The smoke user is a curator.
  await page.getByRole("button", { name: "Publish Clown Car" }).click();
  await expect(row).toContainText("Library");

  // From the Event's Troop Challenges: the library, then Add.
  await page.goBack();
  await page.getByRole("link", { name: "← Back to the Event" }).click();
  await page
    .getByRole("link", {
      name: "Add an Activity from the library to Troop Challenges",
    })
    .click();
  await expect(page.getByLabel("Adding an Activity to")).toHaveValue(/.+/);
  await page
    .getByRole("button", { name: "Add to Troop Challenges: Clown Car" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clown Car");
  await page.getByRole("link", { name: "← Back to the Event" }).click();
  const troop = page.getByRole("region", { name: "Troop Challenges" });
  await expect(troop.getByRole("link", { name: "Clown Car" })).toBeVisible();

  // Put things back.
  page.on("dialog", (dialog) => void dialog.accept());
  await troop.getByRole("button", { name: "Remove Clown Car" }).click();
  await expect(troop.getByRole("link", { name: "Clown Car" })).toHaveCount(0);
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Unpublish Clown Car" }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Clown Car" }),
  ).toContainText("Private");
});

// #102 PR 4 (the #102 acceptance, through the UI): Circus 2026 saved as a Template, published, downloaded, and a
// new Event made from it. It runs last; the Template and the new Event stay (no earlier test looks for them).
test("an owner makes a Template of Circus 2026 and a new Event from it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();

  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", {
      name: "Save Coyote Creek District Camporee 2026 as a Template",
    })
    .click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await page.getByRole("button", { name: "Templates" }).click();
  const row = page
    .getByRole("listitem")
    .filter({ hasText: "Template ·" })
    .filter({ hasText: "Coyote Creek District Camporee 2026" });
  await expect(row).toContainText("Private");
  await row.getByRole("button", { name: /^Publish / }).click();
  await expect(row).toContainText("Library");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    row.getByRole("button", { name: /as a zip$/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(
    "coyote-creek-camporee-2026-template.zip",
  );

  await row.getByRole("button", { name: /^New Event from / }).click();
  await row.getByLabel("Title").fill("Spring Camporee from the Template");
  await row.getByRole("button", { name: "Create Event" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Spring Camporee from the Template",
  );
  await expect(
    page.getByRole("region", { name: "Troop Challenges" }),
  ).toBeVisible();
});

// #102 PR 5: one editor. A Template opens in the Event editor (no contacts, no Officials); once it's in the library,
// it's the curators' to change. A saved Activity opens on its own. Runs after PR 4's test, so its Template exists too.
test("an owner edits a Template, publishes it, and opens a saved Activity", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  page.on("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", {
      name: "Save Coyote Creek District Camporee 2026 as a Template",
    })
    .click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await page.getByRole("button", { name: "Templates" }).click();
  const fresh = page
    .getByRole("listitem")
    .filter({ hasText: "Template ·" })
    .filter({ hasText: "Coyote Creek District Camporee 2026" })
    .filter({ hasText: "Private" });
  await fresh.getByRole("link", { name: /^Open / }).click();

  // The Event editor, as a Template.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Coyote Creek District Camporee 2026",
  );
  await expect(page.getByText("Template · Private")).toBeVisible();
  await expect(page.getByRole("link", { name: "Officials" })).toHaveCount(0);
  await page.getByRole("link", { name: "Template details" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Template details",
  );
  await expect(page.getByRole("region", { name: "Contacts" })).toHaveCount(0);
  await page.getByLabel("Title", { exact: true }).fill("Big Top Template");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved");
  await page.getByRole("link", { name: "← Back to the Template" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Big Top Template",
  );

  // Published, it's the curators' (the smoke user is one): the note says changes reach everyone.
  await page.getByRole("link", { name: "← Library" }).click();
  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("button", { name: "Publish Big Top Template" }).click();
  const published = page
    .getByRole("listitem")
    .filter({ hasText: "Big Top Template" });
  await expect(published).toContainText("Library");
  await published.getByRole("link", { name: "Open Big Top Template" }).click();
  await expect(page.getByText("Template · In the library.")).toContainText(
    "Your changes reach everyone",
  );
  await page
    .getByRole("region", { name: "Patrol Games" })
    .getByRole("link", { name: "Clown Car" })
    .click();
  await expect(page.getByText("Activity · In the library.")).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toBeEnabled();
  await page.getByRole("link", { name: "← Back to the Template" }).click();

  // A saved Activity (PR 3's test copied Clown Car) opens on its own.
  await page.getByRole("link", { name: "← Library" }).click();
  await page.getByRole("button", { name: "Activities" }).click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Clown Car" })
    .filter({ hasText: "Private" })
    .getByRole("link", { name: "Open Clown Car" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clown Car");
  await expect(page.getByText("Activity · Private")).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Clown Car (saved)");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved");
  await page.getByRole("link", { name: "← Library" }).click();
  await page.getByRole("button", { name: "Activities" }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Clown Car (saved)" }),
  ).toBeVisible();
});

// #103 PR 2: AI brainstorm, with the canned fake provider (AI_ADAPTER=fake). A pick is reviewed, then accepted.
test("an owner takes a theme and an Introduction from the AI", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", {
      name: "Coyote Creek District Camporee 2026",
      exact: true,
    })
    .click();
  await page.getByRole("link", { name: "Event details" }).click();
  const ideas = page.getByRole("region", { name: "Ideas from AI" });
  await expect(ideas).toBeVisible();

  // Unsaved changes first: the AI waits.
  await page.getByLabel("Year").fill("2031");
  await expect(
    ideas.getByRole("button", { name: "Suggest themes" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Discard changes" }).click();

  await ideas.getByRole("button", { name: "Suggest themes" }).click();
  await ideas
    .getByRole("list", { name: "Theme ideas" })
    .getByRole("button", { name: "Use Pirate Cove" })
    .click();
  const review = ideas.getByRole("region", { name: "Proposed change" });
  await expect(review).toContainText("Pirate Cove");
  await review.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByLabel("Theme", { exact: true })).toHaveValue(
    "Pirate Cove",
  );
  await expect(page.getByRole("status").last()).toHaveText("All changes saved");

  await ideas
    .getByRole("button", { name: "Write Introduction options" })
    .click();
  await ideas
    .getByRole("list", { name: "Introduction options" })
    .getByRole("button", { name: "Use Lore" })
    .click();
  // Discard leaves things as they were.
  await review.getByRole("button", { name: "Discard" }).click();
  await expect(review).toHaveCount(0);
  await ideas
    .getByRole("button", { name: "Write Introduction options" })
    .click();
  await ideas.getByRole("button", { name: "Use Lore" }).click();
  await review.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByLabel(/^Introduction/)).toHaveValue(
    /travelling circus/,
  );
});

// #103 PR 3: theme one Activity with the canned fake provider: review the rewrite, discard, then accept.
test("an owner themes an Activity with the AI", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Smoke Test" }).click();
  await page
    .getByRole("link", {
      name: "Coyote Creek District Camporee 2026",
      exact: true,
    })
    .click();
  await page
    .getByRole("region", { name: "Patrol Games" })
    .getByRole("link", { name: "Clown Car" })
    .click();
  const card = page.getByRole("region", { name: "Theme with AI" });
  await card.getByRole("button", { name: "Theme this Activity" }).click();
  const review = card.getByRole("region", { name: "Proposed change" });
  await expect(review).toContainText("Big Top Clown Car");
  await expect(review).toContainText("Under the Big Top:");
  await review.getByRole("button", { name: "Discard" }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clown Car");

  await card.getByRole("button", { name: "Theme this Activity" }).click();
  await review.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Big Top Clown Car",
  );
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Big Top Clown Car",
  );
});

// #103 PR 4: an AI update with a prompt, on a saved Activity on its own (PR 3 of #102 saved it), then Undo.
test("an owner updates an Activity with the AI, then undoes it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Activities" }).click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Clown Car (saved)" })
    .getByRole("link", { name: /^Open / })
    .click();
  const story = page.getByLabel("Background (story)");
  const before = await story.inputValue();

  const card = page.getByRole("region", { name: "Update with AI" });
  const ask = card.getByRole("button", { name: "Ask the AI" });
  await expect(ask).toBeDisabled();
  await card.getByLabel("What should change?").fill("They lost the keys");
  await ask.click();
  const review = card.getByRole("region", { name: "Proposed change" });
  await expect(review).toContainText("Updated by AI");
  await review.getByRole("button", { name: "Accept" }).click();
  await expect(story).toHaveValue(/Updated by AI/);

  await page.getByRole("button", { name: "Undo AI change" }).click();
  await expect(story).toHaveValue(before);
  await expect(
    page.getByRole("button", { name: "Undo AI change" }),
  ).toHaveCount(0);
});

// #104 PR 1: the admin users list (the smoke user is a sysadmin). The invite test signed newcomer@example.com in.
test("a sysadmin sets a user's flags and suspends them", async ({
  page,
  browser,
}) => {
  const asNewcomer = async () => {
    const context = await browser.newContext();
    const them = await context.newPage();
    await them.goto("/");
    await them.getByLabel("Email").fill("newcomer@example.com");
    await them.getByRole("button", { name: "Sign in" }).click();
    return { context, them };
  };

  // Not a sysadmin: no Admin link, and the page is Not found.
  const before = await asNewcomer();
  await expect(
    before.them.getByRole("heading", { name: "Your Organizations" }),
  ).toBeVisible();
  await expect(before.them.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await before.them.goto("/admin");
  await expect(
    before.them.getByRole("heading", { name: "Not found" }),
  ).toBeVisible();
  await before.context.close();

  await page.goto("/");
  await page.getByLabel("Email").fill("smoke@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await page.getByLabel("Search").fill("newcomer");
  const curator = page.getByLabel("Curator: newcomer@example.com");
  await expect(curator).not.toBeChecked();
  // The box follows the saved flag, so click and wait.
  await curator.click();
  await expect(curator).toBeChecked();
  // Your own sysadmin and suspended flags are locked.
  await page.getByLabel("Search").fill("smoke");
  await expect(page.getByLabel("Sysadmin: smoke@example.com")).toBeDisabled();

  await page.getByLabel("Search").fill("newcomer");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByLabel("Suspended: newcomer@example.com").click();
  await expect(
    page.getByLabel("Suspended: newcomer@example.com"),
  ).toBeChecked();

  const after = await asNewcomer();
  await expect(
    after.them.getByRole("heading", { name: "Account suspended" }),
  ).toBeVisible();
  await after.context.close();

  // Put things back.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByLabel("Suspended: newcomer@example.com").click();
  await expect(
    page.getByLabel("Suspended: newcomer@example.com"),
  ).not.toBeChecked();
});
