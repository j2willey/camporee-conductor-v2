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
