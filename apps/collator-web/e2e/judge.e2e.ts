import { resolve } from "node:path";
import { devices, expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";

// #40 PR 2: a Judge with no account scores a newly added Patrol at Clown Car; a resend after a lost reply
// doesn't duplicate the score; adding the same Patrol again is caught by the name warning.
// #40 PR 3: an Official listed in the cartridge sees that score ranked; an unlisted email is refused.
// #41 PR 2: scores saved with no Wi-Fi are kept on the phone, survive a reload, and arrive once each.
// #41 PR 3: with no Wi-Fi the page still opens after a reload, a Patrol can be added and scored, and both
// arrive when it's back; a changed event is announced.
// #41 follow-up: out of range is normal. An offline save moves on at once and is never shown in red; the
// page shows its build; a box it can't reach comes with the Nearby devices hint.
// #41 PR 4: a half-filled form and a running stopwatch survive a reload; Stop gives the m:ss saved.
// #41 PR 5: one Competition's Activities at a time, remembered; the Judge's home unit reaches Officials.
// #41 PR 6: a Judge closes an Activity once everything has gone; Officials see it, and a reopen.
// #41 PR 7: the Official prints QR codes (Wi-Fi, judge page, one per Activity); an Activity's code opens
// the judge page at that Activity, and an old printout's code falls back to the list.
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

/** The header line that counts what's kept on the phone and not yet in the box (#41 PR 2). */
const waitingToSend = (page: Page) =>
  page.getByRole("status", { name: "Waiting to send" });

async function scoreFlamingArrows(page: Page) {
  await page
    .getByRole("button", { name: "Flaming Arrows (Troop 101)" })
    .click();
  await page.getByLabel("Big Top Cruiser Clowns").fill("8");
  await page.getByLabel("Patrol Flag").fill("4");
  await page.getByRole("button", { name: "Save score" }).click();
}

async function startJudging(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Who's judging?" }),
  ).toBeVisible();
  await page.getByLabel("Name").fill("Alex Judge");
  await page.getByLabel("Email").fill("alex@example.com");
  await page.getByRole("button", { name: "Start judging" }).click();
  await page.getByRole("button", { name: "Clown Car", exact: true }).click();
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

  // Adding is safe to resend too: the box saves the Patrol, but the phone never hears back. The outbox
  // resends it with the same id (#41 PR 3), and the Judge goes on to the form.
  let teamReplyLost = false;
  await page.route("**/api/teams/*", async (route) => {
    if (teamReplyLost) return route.continue();
    teamReplyLost = true;
    await route.fetch();
    await route.fulfill({ status: 503, json: { error: "no answer" } });
  });
  await page.getByRole("button", { name: "Add Patrol" }).click();

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
  // No answer, so it's kept on the phone (#41 PR 2) and the Judge moves on.
  await expect(page.getByText(/^Saved on this phone:/)).toBeVisible();
  await expect(waitingToSend(page)).toHaveText(/1 score waiting to send/);

  // The outbox resends it on its own, same id: the box already has it, so it counts once.
  await expect(waitingToSend(page)).toHaveCount(0, { timeout: 10_000 });
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

test("scores saved with no Wi-Fi are kept on the phone and arrive once each when it's back", async ({
  page,
  context,
}) => {
  await startJudging(page);
  const before = count("score_entries");

  // Wi-Fi drops between picking the Patrol and saving.
  await page
    .getByRole("button", { name: "Flaming Arrows (Troop 101)" })
    .waitFor();
  await context.setOffline(true);
  await scoreFlamingArrows(page);
  await expect(page.getByText(/^Saved on this phone:/)).toBeVisible();
  await expect(waitingToSend(page)).toHaveText(/1 score waiting to send/);
  expect(count("score_entries")).toBe(before);

  // Back in range: it goes by itself.
  await context.setOffline(false);
  await expect(waitingToSend(page)).toHaveCount(0, { timeout: 10_000 });
  expect(count("score_entries")).toBe(before + 1);

  // The box can't be reached for scores, and the page is reloaded: the score is still on the phone.
  await page.route("**/api/scores/*", (route) => route.abort());
  await page.getByRole("button", { name: "Score another Patrol" }).click();
  await scoreFlamingArrows(page);
  await expect(page.getByText(/^Saved on this phone:/)).toBeVisible();
  await page.reload();
  await expect(waitingToSend(page)).toHaveText(/1 score waiting to send/);

  await page.unroute("**/api/scores/*");
  await waitingToSend(page).getByRole("button", { name: "Send now" }).click();
  await expect(waitingToSend(page)).toHaveCount(0);
  expect(count("score_entries")).toBe(before + 2);
});

test("out of range is normal: an offline save moves on at once, never in red, and arrives once when it's back", async ({
  page,
  context,
}) => {
  await startJudging(page);
  // Which build this is, on the page itself.
  await expect(page.getByText(/^Build \w+/)).toBeVisible();
  await page
    .getByRole("button", { name: "Flaming Arrows (Troop 101)" })
    .waitFor();
  const before = count("score_entries");

  await context.setOffline(true);
  await scoreFlamingArrows(page);
  // Straight on to the next Patrol: no waiting on the box.
  await expect(
    page.getByRole("button", { name: "Score another Patrol" }),
  ).toBeVisible({ timeout: 1_000 });
  await expect(page.getByText(/^Saved on this phone:/)).toBeVisible();
  await expect(waitingToSend(page)).toHaveText(/1 score waiting to send/);
  // Red is only for the box saying no.
  await expect(page.locator(".bg-red-50")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByText(/Not saved|Try again|Check the Wi-Fi/),
  ).toHaveCount(0);

  await context.setOffline(false);
  await expect(waitingToSend(page)).toHaveCount(0, { timeout: 10_000 });
  expect(count("score_entries")).toBe(before + 1);
});

test("with no Wi-Fi the page opens after a reload, and a Patrol added and scored there arrives when it's back", async ({
  page,
  context,
}) => {
  await startJudging(page);
  // The phone has seen the event and the roster once, and the service worker has kept the app.
  await page
    .getByRole("button", { name: "Flaming Arrows (Troop 101)" })
    .waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const teams = count("teams");
  const scores = count("score_entries");

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("status").first()).toContainText(
    "using the event saved on this phone",
  );
  await page.getByRole("button", { name: "Clown Car", exact: true }).click();
  await page
    .getByRole("button", { name: "Patrol not listed? Add one" })
    .click();
  await page.getByRole("combobox").selectOption({ label: "Troop 101" });
  await page.getByLabel("Patrol name").fill("Owls");
  await page.getByRole("button", { name: "Add Patrol" }).click();
  await expect(
    page.getByRole("heading", { name: "Owls (Troop 101)" }),
  ).toBeVisible();
  await page.getByLabel("Big Top Cruiser Clowns").fill("6");
  await page.getByLabel("Patrol Flag").fill("3");
  await page.getByRole("button", { name: "Save score" }).click();
  await expect(page.getByText(/^Saved on this phone:/)).toBeVisible();
  await expect(waitingToSend(page)).toHaveText(/2 waiting to send/);

  // The Patrol added on this phone is listed before the box has it.
  await page.getByRole("button", { name: "Score another Patrol" }).click();
  await expect(
    page.getByRole("button", { name: "Owls (Troop 101)" }),
  ).toBeVisible();
  expect(count("teams")).toBe(teams);

  // Back in range: the Patrol goes first, then its score, once each.
  await context.setOffline(false);
  await expect(waitingToSend(page)).toHaveCount(0, { timeout: 10_000 });
  expect(count("teams")).toBe(teams + 1);
  expect(count("score_entries")).toBe(scores + 1);
  await expect(
    page.getByText("using the event saved on this phone"),
  ).toHaveCount(0);
});

test("a half-filled form and a running stopwatch survive a reload, and the stopwatch's time is saved", async ({
  page,
}) => {
  // The page's clock, run by the test: the stopwatch counts exactly what the test lets pass.
  await page.clock.install();
  const timeField = "Total elapsed time for 3 complete passes";
  const openForm = async () => {
    await page
      .getByRole("button", { name: "3 Ring Circus", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Flaming Arrows (Troop 101)" })
      .click();
  };

  await page.goto("/");
  await page.getByLabel("Name").fill("Alex Judge");
  await page.getByLabel("Email").fill("alex@example.com");
  await page.getByRole("button", { name: "Start judging" }).click();
  await openForm();
  await page.getByLabel("Number of hand breaks (+15 sec each)").fill("2");
  await page.getByRole("button", { name: `Start timer: ${timeField}` }).click();
  await page.clock.fastForward("01:05");
  await expect(
    page.getByRole("timer", { name: `Timer: ${timeField}` }),
  ).toHaveText("1:05");

  // The phone reloads mid-run (a locked screen can do this): the draft and the timer are still there.
  await page.reload();
  await page.getByRole("button", { name: "Back to 3 Ring Circus" }).click();
  await expect(
    page.getByRole("button", { name: "Flaming Arrows (Troop 101)" }),
  ).toContainText("Draft");
  await page
    .getByRole("button", { name: "Flaming Arrows (Troop 101)" })
    .click();
  await expect(page.getByText("Picked up where you left off.")).toBeVisible();
  await expect(
    page.getByLabel("Number of hand breaks (+15 sec each)"),
  ).toHaveValue("2");
  await page.clock.fastForward("00:10");
  await page.getByRole("button", { name: `Stop timer: ${timeField}` }).click();
  await expect(page.getByLabel(timeField, { exact: true })).toHaveValue("1:15");

  const before = count("score_entries");
  await page.getByRole("button", { name: "Save score" }).click();
  await expect(page.getByText(/Score saved/)).toBeVisible();
  expect(count("score_entries")).toBe(before + 1);
  const db = new Database(DB, { readonly: true });
  try {
    const row = db
      .prepare(
        'SELECT "values" AS v FROM score_entries ORDER BY received_seq DESC LIMIT 1',
      )
      .get() as { v: string };
    expect(JSON.parse(row.v)).toMatchObject({
      elapsed_time: "1:15",
      hand_breaks: 2,
    });
  } finally {
    db.close();
  }

  // Saved, so the draft is gone.
  await page.getByRole("button", { name: "Score another Patrol" }).click();
  await expect(
    page.getByRole("button", { name: "Flaming Arrows (Troop 101)" }),
  ).not.toContainText("Draft");
});

test("the Activity list shows one Competition at a time, remembered, and a Judge's home unit reaches the Officials", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Name").fill("Sam Judge");
  await page.getByLabel("Email").fill("sam@example.com");
  // Free text with the event's word for a Group: it needn't be on the roster.
  await page.getByLabel("Your Troop (optional)").fill("Troop 7");
  await page.getByRole("button", { name: "Start judging" }).click();
  await expect(page.getByText("Judging as")).toContainText(
    "Sam Judge (Troop 7)",
  );

  // The event's first Competition shows; the afternoon's Troop Challenges don't crowd it.
  const tab = (name: RegExp) => page.getByRole("tab", { name });
  await expect(tab(/^Patrol Games/)).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "Clown Car", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "The Grand Entrée" }),
  ).toHaveCount(0);

  // After lunch: the Troop Challenges tab, remembered through a reload, with the last Activity on top.
  await tab(/^Troop Challenges/).click();
  await expect(
    page.getByRole("button", { name: "Clown Car", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "The Grand Entrée" }).click();
  await page.getByRole("button", { name: "← Activities" }).click();
  await page.reload();
  await expect(tab(/^Troop Challenges/)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Back to The Grand Entrée" }),
  ).toBeVisible();

  // A score from Sam names the home unit in the Official view.
  await tab(/^Patrol Games/).click();
  await page.getByRole("button", { name: "Clown Car", exact: true }).click();
  await scoreFlamingArrows(page);
  await expect(page.getByText(/Score saved/)).toBeVisible();
  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /Clown Car/ }).click();
  await expect(page.getByText("from Sam Judge (Troop 7)")).toBeVisible();
});

test("a Judge closes an Activity once their scores have gone, and Officials see it, then the reopen", async ({
  page,
  context,
}) => {
  await startJudging(page);
  const close = page.getByRole("button", { name: "I'm done: close Clown Car" });

  // Out of range, a score is still on the phone: closing waits for it.
  await page
    .getByRole("button", { name: "Flaming Arrows (Troop 101)" })
    .waitFor();
  await context.setOffline(true);
  await scoreFlamingArrows(page);
  await page.getByRole("button", { name: "Score another Patrol" }).click();
  await expect(close).toHaveCount(0);
  await expect(
    page.getByText("1 of your scores here is still waiting to send."),
  ).toBeVisible();

  // Back in range: it goes, and the box confirms it has it.
  await context.setOffline(false);
  await expect(waitingToSend(page)).toHaveCount(0, { timeout: 10_000 });
  await close.click();
  await expect(
    page.getByText("Closed. The box has your score at Clown Car."),
  ).toBeVisible();
  await page.getByRole("button", { name: "← Activities" }).click();
  await expect(page.getByRole("button", { name: /^Clown Car/ })).toContainText(
    "Closed",
  );

  // The Official view.
  const official = await context.newPage();
  await official.goto("/official");
  await official.getByLabel("Email").fill("lead.judge@example.com");
  await official.getByRole("button", { name: "Sign in" }).click();
  await expect(
    official.getByRole("button", { name: /Clown Car/ }),
  ).toContainText("Closed by 1");
  await official.getByRole("button", { name: /Clown Car/ }).click();
  await expect(
    official.getByText("Alex Judge closed it with 1 score: all here."),
  ).toBeVisible();

  // Scoring there again reopens it, on the phone and for Officials.
  await page.getByRole("button", { name: /^Clown Car/ }).click();
  await scoreFlamingArrows(page);
  await expect(page.getByText(/^Score saved:/)).toBeVisible();
  await page.getByRole("button", { name: "Score another Patrol" }).click();
  await expect(close).toBeVisible();
  await official.reload();
  await expect(
    official.getByRole("button", { name: /Clown Car/ }),
  ).toContainText("Check closures");
  await official.getByRole("button", { name: /Clown Car/ }).click();
  await expect(
    official.getByText("Then scored 1 more: reopened."),
  ).toBeVisible();
});

test("an Official prints QR codes, and an Activity's code opens the judge page at that Activity", async ({
  page,
  browser,
}) => {
  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "QR codes to print" }).click();
  await expect(
    page.getByRole("heading", { name: "QR codes to print" }),
  ).toBeVisible();

  const code = (name: string) =>
    page.getByRole("img", { name: `QR code: ${name}`, exact: true });
  // No Wi-Fi name yet: no Wi-Fi code, just the judge page and one per Activity.
  await expect(code("1. Join the Wi-Fi")).toHaveCount(0);
  await expect(code("Judge page")).toHaveAttribute(
    "data-qr-text",
    "http://localhost:3040/",
  );
  await page.getByLabel("Wi-Fi name").fill("Coyote Creek");
  await page.getByLabel("Wi-Fi password").fill("big;top");
  await expect(code("1. Join the Wi-Fi")).toHaveAttribute(
    "data-qr-text",
    "WIFI:T:WPA;S:Coyote Creek;P:big\\;top;;",
  );
  await expect(code("2. Open the judge page")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Troop Challenges" }),
  ).toBeVisible();
  const clownCar = await code("Clown Car").getAttribute("data-qr-text");
  // Clown Car's id in the Circus 2026 fixture.
  expect(clownCar).toBe(
    "http://localhost:3040/?activity=01a18a1b-3000-7872-beea-714277375bbe",
  );

  // A new Judge scans Clown Car's code: details first, then straight to Clown Car's Patrols.
  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  const judge = await phone.newPage();
  await judge.goto(clownCar ?? "");
  await judge.getByLabel("Name").fill("Pat Judge");
  await judge.getByLabel("Email").fill("pat@example.com");
  await judge.getByRole("button", { name: "Start judging" }).click();
  await expect(judge.getByRole("heading", { name: "Clown Car" })).toBeVisible();
  // The link is dropped from the address: a reload shows the list, with Clown Car on top.
  expect(new URL(judge.url()).search).toBe("");
  await judge.reload();
  await expect(
    judge.getByRole("button", { name: "Back to Clown Car" }),
  ).toBeVisible();

  // A code from an older printout names an Activity this event doesn't have.
  await judge.goto("/?activity=tightrope");
  await expect(
    judge.getByRole("status").filter({ hasText: "That QR code" }),
  ).toContainText("That QR code is for an Activity this event doesn't have.");
  await expect(
    judge.getByRole("heading", { name: "Which Activity are you judging?" }),
  ).toBeVisible();
  await phone.close();
});

test.describe("without the service worker", () => {
  // Playwright can't route the page's requests once the service worker controls it, and these checks are
  // the page's own: run them with the service worker blocked.
  test.use({ serviceWorkers: "block" });

  test("a phone that can't reach the box, with nothing kept, gets the Nearby devices hint, not red", async ({
    page,
  }) => {
    await page.route("**/api/event", (route) => route.abort());
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText(
      "Can't reach the scoring box.",
    );
    await expect(page.getByRole("alert")).toContainText("Nearby devices");
    await expect(page.locator(".bg-red-50")).toHaveCount(0);
  });

  test("a Judge is told when the event changed on the box", async ({
    page,
  }) => {
    await startJudging(page);
    await page.route("**/api/event", async (route) => {
      const response = await route.fetch();
      const event = (await response.json()) as { event: { title: string } };
      event.event.title = "Circus 2026 (moved to Saturday)";
      await route.fulfill({ response, json: event });
    });
    // The page asks again when the phone is back online or the page is shown again.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("alert")).toContainText(
      "The event was changed on the scoring box.",
    );
    await page
      .getByRole("button", { name: "Reload to get the changes" })
      .click();
    await expect(
      page.getByText("Circus 2026 (moved to Saturday)"),
    ).toBeVisible();
  });
});
