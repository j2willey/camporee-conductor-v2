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
// #42 PR 1: the Official's Overview shows each Activity's counts, and a conflict when a second Judge
// scores the same Patrol.
// #42 PR 2a: an Activity's Scores matrix: a row per Patrol, a conflict marked, unscored Patrols listed.
// #42 PR 2b: an Official DQs the Patrol in 1st and reinstates it; everyone below moves up, and the row says who.
// #42 PR 3: an Official corrects the 2nd-placed Patrol's flag to take 1st, reverts it, and dismisses a correction
// once a newer score has made it stale.
// #42 PR 4: an Official resolves Night Owls' conflict by choosing Alex's older entry, a newer score reopens it,
// and choosing the newest accepts it; the Overview's Conflicts count follows.
// #42 PR 5: an Official sets a manual rank, finalizes Clown Car (the Overview says Final), a correction then waits,
// and unfinalizing applies it.
// #42 PR 4 (2): an Official opens Standings, DQs the top Patrol overall (the next is 1st), reinstates it, and sets an
// overall rank, which says what the box gave.
// #42 PR 6: two Judges each add the same Patrol under nearly the same name and score it; an Official merges them on
// the Roster page (one row, a conflict, one Standings row), unmerges (two again), and merges again.
// #42 PR 7: an Official records an Exhibition's results (William Tell No Apple), reorders them and saves again; the
// Overview counts them.
// #42 PR 8: an Official resets scores: the button waits for the typed name, the backup is named, the Overview
// shows no scores, and the roster stays.
// #42 PR 8 (2): a phone that kept a sent score and an unsent one drops both after a reset, and says so.
// Each test uses what the one before it stored, so they run in order.
test.describe.configure({ mode: "serial" });

const DB = resolve(import.meta.dirname, "../test-results/judge.db");
/** The first row of a read-only query on the box's database. */
const firstRow = (sql: string, ...params: string[]) => {
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare(sql).get(...params) as Record<string, string>;
  } finally {
    db.close();
  }
};
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
  await expect(page.getByRole("heading", { name: "Overview" })).toHaveCount(0);

  // Listed in the event-day cartridge (apps/collator/src/test-support.ts); case doesn't matter.
  await page.getByLabel("Email").fill("Lead.Judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("button", { name: /Clown Car/ }).click();

  await expect(page.getByRole("heading", { name: "Clown Car" })).toBeVisible();
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows).toHaveCount(2);
  // 7 clowns + 5 for the flag + Midway Mite's default 6, totalled by packages/scoring.
  await expect(rows.nth(1).getByRole("rowheader")).toHaveText(
    "Flaming Arrows (Troop 101)",
  );
  const cells = rows.nth(1).getByRole("cell");
  await expect(cells.first()).toHaveText("1st");
  await expect(cells.filter({ hasText: /^18$/ })).toHaveCount(1);
  await expect(
    page.getByRole("columnheader", { name: "Patrol", exact: true }),
  ).toBeVisible();
  // The raw entry, with the Judge's name and the values as entered.
  await expect(page.getByText("from Alex Judge")).toBeVisible();
  await expect(
    page.getByText("Big Top Cruiser Clowns", { exact: true }).first(),
  ).toBeVisible();

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
  // The outbox also retries on its own timer, so it may send before the click lands and the button goes (#85).
  // That's fine; a click that fails while the score is still waiting is not.
  await waitingToSend(page)
    .getByRole("button", { name: "Send now" })
    .click({ timeout: 5_000 })
    .catch(async (e: unknown) => {
      if ((await waitingToSend(page).count()) > 0) throw e;
    });
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
  await expect(official.getByRole("row", { name: /Clown Car/ })).toContainText(
    "Closed by 1",
  );
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
  await expect(official.getByRole("row", { name: /Clown Car/ })).toContainText(
    "Check closures",
  );
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

test("the Official's Overview shows Clown Car's counts, refreshes by itself, and flags a Patrol scored by two Judges", async ({
  page,
  browser,
}) => {
  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  const row = page.getByRole("row", { name: /Clown Car/ });
  const cell = async (n: number) =>
    (await row.getByRole("cell").nth(n).textContent()) ?? "";
  // Earlier tests left scores here, from Alex and Sam, and Flaming Arrows scored by both.
  await expect(page.getByText(/^Updated /)).toBeVisible();
  await expect(
    page.getByText(/scores? across \d+ of \d+ Activities/),
  ).toBeVisible();
  const entries = Number(await cell(2));
  const judges = Number(await cell(3));
  expect(entries).toBeGreaterThanOrEqual(3);
  expect(judges).toBeGreaterThanOrEqual(2);
  expect(await cell(6)).toMatch(/^\d\d:\d\d/);
  const conflicts = (await cell(5)) === "—" ? 0 : Number(await cell(5));
  expect(conflicts).toBeGreaterThanOrEqual(1);

  // Alex (on a new phone, so a new Judge) adds a new Patrol and scores it; Quinn, scores the same Patrol.
  const alex = await browser.newContext({ ...devices["Pixel 7"] });
  const alexPage = await alex.newPage();
  await startJudging(alexPage);
  await alexPage
    .getByRole("button", { name: "Patrol not listed? Add one" })
    .click();
  await alexPage.getByRole("combobox").selectOption({ label: "Troop 101" });
  await alexPage.getByLabel("Patrol name").fill("Night Owls");
  await alexPage.getByRole("button", { name: "Add Patrol" }).click();
  await alexPage.getByLabel("Big Top Cruiser Clowns").fill("5");
  await alexPage.getByLabel("Patrol Flag").fill("2");
  await alexPage.getByRole("button", { name: "Save score" }).click();
  await expect(alexPage.getByText(/^Score saved:/)).toBeVisible();

  const quinn = await browser.newContext({ ...devices["Pixel 7"] });
  const quinnPage = await quinn.newPage();
  await quinnPage.goto("/");
  await quinnPage.getByLabel("Name").fill("Quinn Judge");
  await quinnPage.getByLabel("Email").fill("quinn@example.com");
  await quinnPage.getByRole("button", { name: "Start judging" }).click();
  await quinnPage
    .getByRole("button", { name: "Clown Car", exact: true })
    .click();
  await quinnPage
    .getByRole("button", { name: "Night Owls (Troop 101)" })
    .click();
  await quinnPage.getByLabel("Big Top Cruiser Clowns").fill("6");
  await quinnPage.getByLabel("Patrol Flag").fill("3");
  await quinnPage.getByRole("button", { name: "Save score" }).click();
  await expect(quinnPage.getByText(/^Score saved:/)).toBeVisible();

  // Nobody reloads the Official's page: the Overview asks the box again within 15 s.
  await expect(row.getByRole("cell").nth(2)).toHaveText(String(entries + 2), {
    timeout: 30_000,
  });
  await expect(row.getByRole("cell").nth(3)).toHaveText(String(judges + 2));
  await expect(row.getByRole("cell").nth(5)).toHaveText(String(conflicts + 1));
  await alex.close();
  await quinn.close();
});

test("an Official opens Clown Car and sees its Scores matrix: the conflict marked, the newest values, and Patrols not yet scored", async ({
  page,
}) => {
  // A Patrol nobody has scored, added the way a phone adds one.
  expect(
    (
      await page.request.put("/api/groups/group-unscored", {
        data: { name: "Troop 909" },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.put("/api/teams/team-unscored", {
        data: { groupId: "group-unscored", name: "Quiet Foxes" },
      })
    ).ok(),
  ).toBe(true);

  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Clown Car" }).click();
  await expect(page.getByRole("heading", { name: "Scores" })).toBeVisible();

  const scores = page.getByRole("table").first();
  await expect(
    scores.getByRole("columnheader", { name: "Big Top Cruiser Clowns" }),
  ).toBeVisible();
  await expect(
    scores.getByRole("columnheader", { name: "Patrol Flag" }),
  ).toBeVisible();

  // Alex and Quinn both scored Night Owls; Quinn's, received last, counts.
  const conflict = scores.getByRole("row", {
    name: /Night Owls \(Troop 101\)/,
  });
  await expect(conflict).toContainText("Conflict");
  await expect(conflict).toContainText("Alex Judge");
  await expect(conflict).toContainText("Quinn Judge");
  // The cell in each field's column, found by the header's position (the entrant is a row header, not a cell).
  const headers = await scores.getByRole("columnheader").allTextContents();
  const valueIn = (label: string) =>
    conflict.getByRole("cell").nth(headers.indexOf(label) - 1);
  await expect(valueIn("Big Top Cruiser Clowns")).toHaveText("6");
  await expect(valueIn("Patrol Flag")).toHaveText("3");

  await expect(scores.getByRole("row", { name: /Quiet Foxes/ })).toContainText(
    "Not scored",
  );
});

test("an Official DQs the Patrol in 1st with a reason, everyone below moves up, and reinstating brings its place back", async ({
  page,
}) => {
  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Clown Car" }).click();
  await expect(page.getByRole("heading", { name: "Scores" })).toBeVisible();

  const scores = page.getByRole("table").first();
  const rows = scores.locator("tbody tr");
  const placeOf = (row: ReturnType<typeof rows.nth>) =>
    row.getByRole("cell").first();
  const nameOf = (row: ReturnType<typeof rows.nth>) =>
    row.getByRole("rowheader");
  // The first two rows, best first; each is found again by name once the table is re-ordered.
  const first = (await nameOf(rows.nth(0)).innerText()).split("\n")[0] ?? "";
  const second = (await nameOf(rows.nth(1)).innerText()).split("\n")[0] ?? "";
  expect(first).not.toBe(second);
  const rowFor = (name: string) =>
    scores.getByRole("row").filter({
      has: page.getByRole("rowheader", {
        name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`),
      }),
    });
  await expect(placeOf(rowFor(first))).toHaveText("1st");
  await expect(placeOf(rowFor(second))).not.toHaveText("DQ");
  const secondPlaceBefore = await placeOf(rowFor(second)).innerText();
  expect(secondPlaceBefore).not.toBe("");

  const official = rowFor(first).getByRole("cell").last();
  await official.getByRole("button", { name: "DQ", exact: true }).click();
  await official.getByLabel("Reason").fill("Left the station early");
  await official.getByRole("button", { name: "Confirm DQ" }).click();

  await expect(placeOf(rowFor(first))).toHaveText("DQ");
  await expect(rowFor(first)).toContainText("DQ by lead.judge@example.com");
  await expect(rowFor(first)).toContainText("Left the station early");
  await expect(placeOf(rowFor(second))).toHaveText("1st");

  const reinstate = rowFor(first).getByRole("cell").last();
  await reinstate.getByRole("button", { name: "Reinstate" }).click();
  await reinstate.getByRole("button", { name: "Confirm reinstate" }).click();
  await expect(placeOf(rowFor(first))).toHaveText("1st");
  await expect(rowFor(first)).not.toContainText("DQ by");
  await expect(placeOf(rowFor(second))).toHaveText(secondPlaceBefore);
});

test("an Official corrects the 2nd-placed Patrol's flag to take 1st, reverts it, and dismisses a correction a newer score made stale", async ({
  page,
}) => {
  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Clown Car" }).click();
  await expect(page.getByRole("heading", { name: "Scores" })).toBeVisible();

  const scores = page.getByRole("table").first();
  const rows = scores.locator("tbody tr");
  const nameOf = (row: ReturnType<typeof rows.nth>) =>
    row.getByRole("rowheader");
  const second = (await nameOf(rows.nth(1)).innerText()).split("\n")[0] ?? "";
  const rowFor = (name: string) =>
    scores
      .getByRole("row")
      // The name starts the row header ("Owls" must not match "Night Owls").
      .filter({
        has: page.getByRole("rowheader", {
          name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`),
        }),
      });
  const placeOf = (name: string) => rowFor(name).getByRole("cell").first();
  const secondPlace = await placeOf(second).innerText();
  expect(secondPlace).toBe("2nd");

  // Correct the Patrol Flag (the clowns are 0 to 9, the flag 0 to 5; past the range is allowed, with a warning).
  const correctFlag = async () => {
    await rowFor(second)
      .getByRole("button", { name: `Correct Patrol Flag for ${second}` })
      .click();
    await rowFor(second)
      .getByRole("textbox", { name: `Patrol Flag for ${second}` })
      .fill("99");
    await rowFor(second).getByLabel("Reason").fill("Flag re-counted");
    await rowFor(second)
      .getByRole("button", { name: "Confirm correction" })
      .click();
  };
  await correctFlag();
  await expect(placeOf(second)).toHaveText("1st");
  await expect(rowFor(second)).toContainText("was ");
  await expect(rowFor(second)).toContainText("Corrected Patrol Flag:");
  await expect(rowFor(second)).toContainText("by lead.judge@example.com");
  await expect(rowFor(second)).toContainText("Flag re-counted");
  await expect(rowFor(second)).toContainText("Patrol Flag must be from 0 to 5");

  // Revert: the Judge's value counts again.
  await rowFor(second).getByRole("button", { name: "Revert" }).click();
  await rowFor(second).getByRole("button", { name: "Confirm revert" }).click();
  await expect(placeOf(second)).toHaveText(secondPlace);
  await expect(rowFor(second)).not.toContainText("Corrected Patrol Flag:");

  // Correct again, then a newer score for that Patrol arrives: the correction was on the older entry.
  await correctFlag();
  await expect(placeOf(second)).toHaveText("1st");
  const name = second.split(" (")[0] ?? "";
  const { entrant_id: entrantId, activity_id: activityId } = firstRow(
    "SELECT se.entrant_id, se.activity_id FROM score_entries se JOIN teams t ON t.id = se.entrant_id WHERE t.name = ? LIMIT 1",
    name,
  );
  expect(
    (
      await page.request.put("/api/scores/score-newer-1", {
        data: {
          judge: {
            id: "judge-late",
            name: "Late Judge",
            email: "late@example.com",
          },
          activityId,
          entrantId,
          values: { scouts_balanced: 5, p_flag: 4 },
          phoneCreatedAt: new Date().toISOString(),
        },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Clown Car" }).click();
  await expect(rowFor(second)).toContainText("was on an older entry");
  await rowFor(second).getByRole("button", { name: "Dismiss" }).click();
  await expect(rowFor(second)).not.toContainText("was on an older entry");
});

test("an Official resolves Night Owls' conflict with Use this entry, a newer score reopens it, and choosing the newest resolves it again", async ({
  page,
}) => {
  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  const conflictsCell = async () => {
    const cells = page
      .getByRole("row", { name: /Clown Car/ })
      .getByRole("cell");
    return ((await cells.nth(5).textContent()) ?? "").trim();
  };
  const before = await conflictsCell();
  const countOf = (text: string) => (text === "—" ? 0 : Number(text));
  expect(countOf(before)).toBeGreaterThanOrEqual(1);

  await page.getByRole("button", { name: "Clown Car" }).click();
  await expect(page.getByRole("heading", { name: "Scores" })).toBeVisible();
  const scores = page.getByRole("table").first();
  const owls = scores.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: /^Night Owls \(Troop 101\)/ }),
  });
  const headers = await scores.getByRole("columnheader").allTextContents();
  const valueIn = (label: string) =>
    owls.getByRole("cell").nth(headers.indexOf(label) - 1);
  await expect(owls).toContainText("Conflict");

  // Alex's entry is the older one (5 and 2); Quinn's counts now (6 and 3).
  await owls
    .getByRole("listitem")
    .filter({ hasText: "Alex Judge" })
    .getByRole("button", { name: "Use this entry" })
    .click();
  await owls.getByLabel("Reason").fill("Quinn scored the wrong Patrol");
  await owls.getByRole("button", { name: "Confirm choice" }).click();
  await expect(owls).toContainText("Resolved:");
  await expect(owls).toContainText("Quinn scored the wrong Patrol");
  await expect(valueIn("Big Top Cruiser Clowns")).toHaveText("5");
  await expect(valueIn("Patrol Flag")).toHaveText("2");
  await expect(owls).not.toHaveClass(/bg-amber-50/);

  // The Overview reads the box afresh when it opens: one fewer conflict.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  expect(countOf(await conflictsCell())).toBe(countOf(before) - 1);

  // A newer score for Night Owls reopens it, and the newest counts again.
  const { entrant_id: entrantId, activity_id: activityId } = firstRow(
    "SELECT se.entrant_id, se.activity_id FROM score_entries se JOIN teams t ON t.id = se.entrant_id WHERE t.name = ? LIMIT 1",
    "Night Owls",
  );
  expect(
    (
      await page.request.put("/api/scores/score-owls-newer", {
        data: {
          judge: {
            id: "judge-late-2",
            name: "Late Judge",
            email: "late@example.com",
          },
          activityId,
          entrantId,
          values: { scouts_balanced: 7, p_flag: 1 },
          phoneCreatedAt: new Date().toISOString(),
        },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Clown Car" }).click();
  await expect(owls).toContainText("A newer entry arrived after");
  await expect(valueIn("Big Top Cruiser Clowns")).toHaveText("7");

  // Choosing the newest accepts the default: resolved.
  await owls
    .getByRole("listitem")
    .filter({ hasText: "Late Judge" })
    .getByRole("button", { name: "Use this entry" })
    .click();
  await owls.getByRole("button", { name: "Confirm choice" }).click();
  await expect(owls).toContainText("Resolved:");
  await expect(owls).not.toContainText("A newer entry arrived after");
  await expect(valueIn("Big Top Cruiser Clowns")).toHaveText("7");
});

test("an Official sets a manual rank, finalizes Clown Car, sees a correction wait, and unfinalizing applies it", async ({
  page,
}) => {
  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Clown Car" }).click();
  await expect(page.getByRole("heading", { name: "Scores" })).toBeVisible();
  await expect(page.getByText("Not finalized")).toBeVisible();

  const scores = page.getByRole("table").first();
  const rows = scores.locator("tbody tr");
  const nameOf = (n: number) =>
    rows
      .nth(n)
      .getByRole("rowheader")
      .innerText()
      .then((t) => t.split("\n")[0] ?? "");
  const first = await nameOf(0);
  const second = await nameOf(1);
  // The name as the start of the row header ("Owls" is also in "Night Owls").
  const rowFor = (name: string) =>
    scores.getByRole("row").filter({
      has: page.getByRole("rowheader", {
        name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`),
      }),
    });
  const place = (name: string) => rowFor(name).getByRole("cell").first();
  const headers = await scores.getByRole("columnheader").allTextContents();
  const totalOf = (name: string) =>
    rowFor(name)
      .getByRole("cell")
      .nth(headers.indexOf("Total") - 1);
  const secondBefore = await place(second).innerText();

  // A manual rank: the 2nd-placed row takes 1st, and says what the box gave on its own.
  const official = rowFor(second).getByRole("cell").last();
  await official.getByRole("button", { name: `Rank for ${second}` }).click();
  await official.getByLabel(`Rank for ${second}`).fill("1");
  await official.getByLabel("Reason").fill("Tie-break by time");
  await official.getByRole("button", { name: "Confirm rank" }).click();
  await expect(place(second)).toHaveText(`1st (auto ${secondBefore})`);
  await expect(rowFor(second)).toContainText("Manual rank 1 by");
  await expect(rowFor(second)).toContainText("Tie-break by time");

  // Finalize: the header and the Overview say so.
  await page.getByRole("button", { name: "Finalize", exact: true }).click();
  await page.getByRole("button", { name: "Confirm finalize" }).click();
  await expect(page.getByText(/^Finalized by /)).toBeVisible();
  await expect(
    page.getByText("Changes wait until it's unfinalized."),
  ).toBeVisible();
  await page.getByRole("button", { name: "← All Activities" }).click();
  await expect(page.getByRole("row", { name: /Clown Car/ })).toContainText(
    "Final",
  );
  await page.getByRole("button", { name: "Clown Car" }).click();

  // A correction waits: the total and place don't move.
  const totalBefore = await totalOf(first).innerText();
  const placeBefore = await place(first).innerText();
  await rowFor(first)
    .getByRole("button", { name: `Correct Patrol Flag for ${first}` })
    .click();
  await rowFor(first).getByLabel(`Patrol Flag for ${first}`).fill("9");
  await rowFor(first)
    .getByRole("button", { name: "Confirm correction" })
    .click();
  await expect(rowFor(first)).toContainText(
    "waits until the Activity is unfinalized",
  );
  await expect(totalOf(first)).toHaveText(totalBefore);
  await expect(place(first)).toHaveText(placeBefore);

  // Unfinalize: the correction applies.
  await page.getByRole("button", { name: "Unfinalize" }).click();
  await page.getByRole("button", { name: "Confirm unfinalize" }).click();
  await expect(page.getByText("Not finalized")).toBeVisible();
  await expect(rowFor(first)).toContainText("Corrected Patrol Flag");
  await expect(rowFor(first)).not.toContainText("waits until");
});

test("an Official opens Standings, DQs the top Patrol overall, reinstates it, and sets an overall rank", async ({
  page,
}) => {
  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Standings" }).click();
  await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();

  const table = page.getByRole("table").first();
  await expect(
    table.getByRole("columnheader", { name: "Clown Car (provisional)" }),
  ).toBeVisible();
  const rows = table.locator("tbody tr");
  const headers = await table.getByRole("columnheader").allTextContents();
  const clownCol = headers.findIndex((h) => h.startsWith("Clown Car"));
  expect(
    await rows.first().getByRole("cell").nth(clownCol).innerText(),
  ).toMatch(/\d/);
  const nameOf = async (n: number) =>
    (await rows.nth(n).getByRole("cell").nth(1).innerText()).split("\n")[0] ??
    "";
  const top = await nameOf(0);
  const next = await nameOf(1);
  const rowFor = (name: string) =>
    rows.filter({
      has: page.getByRole("cell", {
        name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`),
      }),
    });

  // An overall DQ: the row says so, and the next one is 1st.
  await rowFor(top)
    .getByRole("button", { name: `DQ ${top} overall` })
    .click();
  await rowFor(top).getByLabel("Reason").fill("Left early");
  await rowFor(top).getByRole("button", { name: "Confirm DQ" }).click();
  await expect(rowFor(top)).toContainText("DQ overall by");
  await expect(rowFor(top)).toContainText("Left early");
  await expect(rowFor(next).getByRole("cell").first()).toHaveText(/^1st/);

  // Reinstated.
  await rowFor(top)
    .getByRole("button", { name: `Reinstate ${top} overall` })
    .click();
  await rowFor(top).getByRole("button", { name: "Confirm reinstate" }).click();
  await expect(rowFor(top)).not.toContainText("DQ overall by");

  // An overall rank on the last row says what the box gave.
  const last = await nameOf((await rows.count()) - 1);
  await rowFor(last)
    .getByRole("button", { name: `Overall rank for ${last}` })
    .click();
  await rowFor(last).getByLabel(`Overall rank for ${last}`).fill("1");
  await rowFor(last).getByRole("button", { name: "Confirm rank" }).click();
  await expect(rowFor(last)).toContainText("Rank set to 1 by");
  await expect(rowFor(last).getByRole("cell").first()).toContainText("(auto");
});

test("an Official merges a Patrol two Judges added under nearly the same name: one row and a conflict, one Standings row; unmerge brings both back", async ({
  page,
}) => {
  // Two phones, offline, each add the Patrol under a slightly different name in the same Troop, and score it.
  const put = async (path: string, data: unknown) => {
    const res = await page.request.put(path, { data });
    expect(res.ok(), await res.text()).toBe(true);
  };
  await put("/api/groups/group-foo", { name: "Troop 505" });
  await put("/api/teams/team-foo-a", {
    groupId: "group-foo",
    name: "Foo fighters",
  });
  await put("/api/teams/team-foo-b", {
    groupId: "group-foo",
    name: "Foo Fighters",
  });
  const event = (await (await page.request.get("/api/event")).json()) as {
    activities: { id: string; title: string }[];
  };
  const clownCar = event.activities.find((a) => a.title === "Clown Car");
  expect(clownCar).toBeDefined();
  const score = (id: string, judge: string, entrantId: string, n: number) =>
    put(`/api/scores/${id}`, {
      judge: {
        id: `judge-${judge}`,
        name: judge,
        email: `${judge}@example.com`,
      },
      activityId: clownCar?.id,
      entrantId,
      values: { scouts_balanced: n, p_flag: 4 },
      phoneCreatedAt: new Date().toISOString(),
    });
  await score("score-foo-a", "Ferris", "team-foo-a", 7);
  await score("score-foo-b", "Gale", "team-foo-b", 6);

  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Roster" }).click();
  await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();
  await page
    .getByRole("button", { name: "Merge Foo fighters into…", exact: true })
    .click();
  await page
    .getByLabel("Merge Foo fighters into", { exact: true })
    .selectOption({
      label: "Foo Fighters",
    });
  await expect(
    page.getByText(
      "Foo fighters's scores will count for Foo Fighters from now on. Standings change at once. You can unmerge later.",
    ),
  ).toBeVisible();
  await page.getByLabel("Reason").fill("Same Patrol, typed twice");
  await page.getByRole("button", { name: "Confirm merge" }).click();
  await expect(
    page.getByText(
      /Foo fighters → Foo Fighters, by .*: Same Patrol, typed twice/,
    ),
  ).toBeVisible();

  // Clown Car: one row, marked a conflict of two Judges.
  let scope = page.getByRole("table").first();
  const foo = (name: RegExp) => scope.getByRole("row", { name });
  const openClownCar = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Clown Car" }).click();
    await expect(page.getByRole("heading", { name: "Scores" })).toBeVisible();
    scope = page.getByRole("table").first();
  };
  await openClownCar();
  await expect(foo(/Foo Fighters \(Troop 505\)/)).toHaveCount(1);
  await expect(foo(/Foo fighters/)).toHaveCount(0);
  await expect(foo(/Foo Fighters \(Troop 505\)/)).toContainText(
    "Conflict: scored by Ferris and Gale",
  );

  // Standings: one row.
  const standingsRows = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Standings" }).click();
    await expect(
      page.getByRole("heading", { name: "Standings" }),
    ).toBeVisible();
    scope = page.getByRole("table").first();
    await expect(scope).toBeVisible();
  };
  await standingsRows();
  await expect(foo(/Foo Fighters \(Troop 505\)/)).toHaveCount(1);
  await expect(foo(/Foo fighters/)).toHaveCount(0);

  // Unmerge: two rows again.
  await page.reload();
  await page.getByRole("button", { name: "Roster" }).click();
  await page
    .getByRole("button", { name: "Unmerge Foo fighters", exact: true })
    .click();
  await expect(page.getByText("Nothing merged.")).toBeVisible();
  await openClownCar();
  await expect(foo(/Foo fighters \(Troop 505\)/)).toHaveCount(1);
  await expect(foo(/Foo Fighters \(Troop 505\)/)).toHaveCount(1);
  await standingsRows();
  await expect(foo(/Foo fighters \(Troop 505\)/)).toHaveCount(1);
  await expect(foo(/Foo Fighters \(Troop 505\)/)).toHaveCount(1);

  // Merged again, so the box ends in a clean state: a merged Patrol is one row, and the History lists the lot.
  await page.reload();
  await page.getByRole("button", { name: "Roster" }).click();
  await page
    .getByRole("button", { name: "Merge Foo fighters into…", exact: true })
    .click();
  await page
    .getByLabel("Merge Foo fighters into", { exact: true })
    .selectOption({
      label: "Foo Fighters",
    });
  await page.getByRole("button", { name: "Confirm merge" }).click();
  await expect(page.getByText("Foo fighters → Foo Fighters")).toBeVisible();
  await expect(page.getByText(/^Unmerged Foo fighters, by /)).toBeVisible();
});

test("an Official moves an entry a Judge scored for the wrong Patrol: its values count for the right one; Move back undoes it", async ({
  page,
}) => {
  const put = async (path: string, data: unknown) => {
    const res = await page.request.put(path, { data });
    expect(res.ok(), await res.text()).toBe(true);
  };
  await put("/api/groups/group-move", { name: "Troop 606" });
  await put("/api/teams/team-wrong", {
    groupId: "group-move",
    name: "Wrong Wolves",
  });
  await put("/api/teams/team-right", {
    groupId: "group-move",
    name: "Right Rams",
  });
  const event = (await (await page.request.get("/api/event")).json()) as {
    activities: { id: string; title: string }[];
  };
  const clownCar = event.activities.find((a) => a.title === "Clown Car");
  expect(clownCar).toBeDefined();
  await put("/api/scores/score-wrong", {
    judge: { id: "judge-Hale", name: "Hale", email: "Hale@example.com" },
    activityId: clownCar?.id,
    entrantId: "team-wrong",
    values: { scouts_balanced: 8, p_flag: 4 },
    phoneCreatedAt: new Date().toISOString(),
  });

  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Clown Car" }).click();
  await expect(page.getByRole("heading", { name: "Scores" })).toBeVisible();
  const scores = page.getByRole("table").first();
  const row = (name: string) =>
    scores.getByRole("row", { name: new RegExp(`^.*${name} \\(Troop 606\\)`) });
  await expect(row("Wrong Wolves")).not.toContainText("Not scored");
  await expect(row("Right Rams")).toContainText("Not scored");

  // Move it from the entries list.
  const entry = page.locator("ol > li").filter({ hasText: "Wrong Wolves" });
  await entry.getByRole("button", { name: "Move to…" }).click();
  await entry
    .getByLabel("Move to")
    .selectOption({ label: "Right Rams (Troop 606)" });
  await entry.getByLabel("Reason").fill("Scored the wrong Patrol");
  await entry.getByRole("button", { name: "Confirm move" }).click();

  await expect(row("Right Rams")).not.toContainText("Not scored");
  await expect(row("Right Rams")).toContainText(
    "Moved here from Wrong Wolves by",
  );
  await expect(row("Right Rams")).toContainText("Scored the wrong Patrol");
  await expect(row("Right Rams")).toContainText("Hale");
  await expect(row("Wrong Wolves")).toContainText("Not scored");

  // Move back.
  await row("Right Rams").getByRole("button", { name: "Move back" }).click();
  await row("Right Rams")
    .getByRole("button", { name: "Confirm move back" })
    .click();
  await expect(row("Right Rams")).toContainText("Not scored");
  await expect(row("Right Rams")).not.toContainText("Moved here from");
  await expect(row("Wrong Wolves")).not.toContainText("Not scored");
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

test("an Official records an Exhibition's results, reorders them, and the Overview counts them", async ({
  page,
}) => {
  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "William Tell No Apple" }).click();
  await expect(
    page.getByRole("heading", { name: "William Tell No Apple" }),
  ).toBeVisible();
  await expect(page.getByText("Not saved yet")).toBeVisible();

  await page.getByRole("button", { name: "Add row" }).click();
  await page.getByLabel("Name, row 1").fill("Alex Archer");
  await page.getByLabel("Place, row 1").fill("1st");
  await page.getByRole("button", { name: "Add row" }).click();
  await page.getByLabel("Name, row 2").fill("Sam Shooter");
  await page.getByLabel("Place, row 2").fill("2nd");
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();
  await page.getByRole("button", { name: "Save results" }).click();
  await expect(
    page.getByText(/Saved by lead\.judge@example\.com/),
  ).toBeVisible();
  await expect(page.getByText("You have unsaved changes.")).toHaveCount(0);

  await page.getByRole("button", { name: "Move row 2 up" }).click();
  await page.getByRole("button", { name: "Save results" }).click();
  await expect(page.getByText("2 results")).toHaveCount(2);
  await page.reload();
  await page.getByRole("button", { name: "William Tell No Apple" }).click();
  await expect(page.getByLabel("Name, row 1")).toHaveValue("Sam Shooter");
  await expect(page.getByLabel("Name, row 2")).toHaveValue("Alex Archer");

  await page.getByRole("button", { name: "← Overview" }).click();
  await expect(
    page.getByRole("row", { name: /William Tell No Apple/ }),
  ).toContainText("2 results");
});

// #43 PR 1: an Official opens Awards from the home page. It's provisional, an Activity shows a 1st place, and the
// Overall Award is there. (The Patrols were scored by the tests above.)
test("an Official opens Awards: provisional, a 1st place at Clown Car, and the Overall Award", async ({
  page,
}) => {
  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Awards" }).click();
  await expect(page.getByRole("heading", { name: "Awards" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    /^Provisional: \d+ of \d+ Activities and 0 of \d+ Exhibitions final\. Awards may change\.$/,
  );
  const clownCar = page
    .getByTestId("awards-activity")
    .filter({ has: page.getByRole("heading", { name: "Clown Car" }) });
  await expect(clownCar).toContainText("1st");
  await expect(
    page
      .getByTestId("awards-award")
      .filter({ has: page.getByRole("heading", { name: "Overall" }) }),
  ).toBeVisible();
});

// #43 PR 3: an Official prints award stickers from Awards: v1's four lines, a label setting saved on the box and kept
// across a reload, one Competition at a time, nothing fetched from outside the box, and only the sheet in print.
// Leaves the box's label as the Event had it (the same words saved back).
test("an Official opens Print stickers: four lines, a saved label line, one Competition, nothing off the box, and only the sheet prints", async ({
  page,
}) => {
  const boxHost = new URL(String(test.info().project.use.baseURL)).host;
  const strangers: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (!["http:", "https:"].includes(url.protocol)) return;
    if (url.host !== boxHost) {
      strangers.push(req.url());
    }
  });
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Awards", exact: true }).click();
  await page.getByRole("button", { name: "Print stickers" }).click();
  await expect(
    page.getByRole("heading", { name: "Award stickers" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Provisional");
  await expect(page.getByTestId("label-source")).toHaveText("From the Event.");

  const clownCar = page
    .getByTestId("sticker")
    .filter({ hasText: "Clown Car" })
    .first();
  await expect(clownCar).toContainText("Coyote Creek Camporee 2026");
  await expect(clownCar).toContainText("The Circus");
  await expect(clownCar).toContainText(/1st Place - \S/);

  // Line 2 changes live, then is saved on the box and kept across a reload.
  await page.getByLabel("Line 2", { exact: true }).fill("Under the Big Top");
  await expect(clownCar).toContainText("Under the Big Top");
  await expect(page.getByTestId("label-source")).toContainText("Not saved yet");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByTestId("label-source")).toContainText(
    "Saved by lead.judge@example.com",
  );
  await page.reload();
  await page.getByRole("button", { name: "Awards", exact: true }).click();
  await page.getByRole("button", { name: "Print stickers" }).click();
  await expect(page.getByLabel("Line 2", { exact: true })).toHaveValue(
    "Under the Big Top",
  );

  // One Competition at a time.
  const all = await page.getByTestId("sticker").count();
  await page.getByLabel("Competition").selectOption({ label: "Patrol Games" });
  const some = await page.getByTestId("sticker").count();
  expect(some).toBeGreaterThan(0);
  // Only Patrol Games has awards yet (its Exhibitions are drafts), so the sheet is the same size.
  expect(some).toBe(all);
  await expect(
    page.getByTestId("sticker").filter({ hasText: "Clown Car" }).first(),
  ).toBeVisible();

  // The Print button prints (stubbed here); in print only the sheet shows.
  await page.getByRole("button", { name: "Print", exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("sticker-controls")).toBeHidden();
  await expect(page.getByTestId("sticker-sheet")).toBeVisible();
  await expect(page.getByText("Signed in as")).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  // Put the label back as the Event had it.
  await page.getByLabel("Line 2", { exact: true }).fill("The Circus");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByTestId("label-source")).toContainText("Saved by");
  expect(strangers).toEqual([]);
});

// #43 PR 2: an Official marks an Exhibition's results final: the save controls go, the Overview says Final, Awards
// lists it; Back to draft makes it editable again.
test("an Official marks an Exhibition final, sees it on Awards, then puts it back to draft", async ({
  page,
}) => {
  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "William Tell No Apple" }).click();
  await expect(page.getByTestId("exhibition-status")).toContainText("Draft");

  await page.getByRole("button", { name: "Mark final" }).click();
  await expect(page.getByTestId("exhibition-status")).toContainText("Final");
  await expect(page.getByTestId("exhibition-status")).toContainText(
    "lead.judge@example.com",
  );
  await expect(page.getByRole("button", { name: "Save results" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Add row" })).toHaveCount(0);
  await expect(page.getByLabel("Name, row 1")).toBeDisabled();

  await page.getByRole("button", { name: "← Overview" }).click();
  await expect(
    page.getByRole("row", { name: /William Tell No Apple/ }),
  ).toContainText("Final");
  await page.getByRole("button", { name: "Awards" }).click();
  await expect(page.getByRole("status")).toContainText(
    /and 1 of \d+ Exhibitions final/,
  );
  const tell = page.getByTestId("awards-exhibition").filter({
    has: page.getByRole("heading", { name: "William Tell No Apple" }),
  });
  await expect(tell).toContainText("Sam Shooter");
  await expect(tell).toContainText("Alex Archer");

  await page.getByRole("button", { name: "← Overview" }).click();
  await page.getByRole("button", { name: "William Tell No Apple" }).click();
  await page.getByRole("button", { name: "Back to draft" }).click();
  await expect(page.getByTestId("exhibition-status")).toContainText("Draft");
  await expect(
    page.getByRole("button", { name: "Save results" }),
  ).toBeVisible();
  await expect(page.getByLabel("Name, row 1")).toBeEnabled();
});

test("an Official resets scores: the typed name enables the button, a backup is saved, scores are gone", async ({
  page,
}) => {
  expect(count("score_entries")).toBeGreaterThan(0);
  const groups = count("groups");
  await page.goto("/official");
  await page.getByLabel("Email").fill("lead.judge@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Reset scores" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Full reset" })).toBeVisible();

  const button = page.getByRole("button", { name: "Reset scores" });
  await expect(button).toBeDisabled();
  await page
    .getByLabel("Type the Event's name to confirm, Reset scores")
    .fill("Not the name");
  await expect(button).toBeDisabled();
  const title = await page
    .getByLabel("Type the Event's name to confirm, Reset scores")
    .getAttribute("placeholder");
  await page
    .getByLabel("Type the Event's name to confirm, Reset scores")
    .fill(` ${title?.toUpperCase()} `);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(
    page.getByText(/Reset done\. Backup saved as collator-.*\.db\./),
  ).toBeVisible();

  expect(count("score_entries")).toBe(0);
  expect(count("official_actions")).toBe(0);
  expect(count("groups")).toBe(groups);
  expect(
    firstRow("SELECT reason FROM box_epochs ORDER BY seq DESC LIMIT 1"),
  ).toEqual({
    reason: "reset",
  });
  await page.getByRole("button", { name: "← Overview" }).click();
  await expect(page.getByText(/^0 scores across 0 of/)).toBeVisible();
});

test("after a reset, a phone drops the scores it kept, sends none of them, and says so", async ({
  page,
}) => {
  await startJudging(page);
  await scoreFlamingArrows(page);
  await expect(page.getByText(/^Score saved:/)).toBeVisible();
  // A second score the box never gets before the reset.
  await page.route("**/api/scores/*", (route) => route.abort());
  await page.getByRole("button", { name: "Score another Patrol" }).click();
  await scoreFlamingArrows(page);
  await expect(page.getByText(/^Saved on this phone:/)).toBeVisible();
  expect(count("score_entries")).toBe(1);

  const { event } = (await (await page.request.get("/api/event")).json()) as {
    event: { title: string };
  };
  const reset = await page.request.post("/api/official/reset", {
    headers: { "x-official-email": "lead.judge@example.com" },
    data: { kind: "scores", confirm: event.title },
  });
  expect(reset.status()).toBe(200);
  expect(count("score_entries")).toBe(0);

  await page.unroute("**/api/scores/*");
  await page.reload();
  await expect(
    page.getByText(
      "The box was reset; 1 unsent score from before the reset was discarded.",
    ),
  ).toBeVisible();
  await expect(waitingToSend(page)).toHaveCount(0);
  await page.waitForTimeout(1_000);
  expect(count("score_entries")).toBe(0);
});
