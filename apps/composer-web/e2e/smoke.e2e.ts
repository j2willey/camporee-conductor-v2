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
  // Read-only: nothing to edit.
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
