import {
  devices,
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { DRONES_URL } from "./playwright.config.ts";

// Judge drones (#63): a few simulated Judges' phones, each with its own storage, on the real box over
// HTTPS. Functional, not load. Each browser (android: Chromium, iphone: WebKit) runs the same story with
// its own names, and the box is checked through the Official API at the end of each step: every score
// and Team saved is there exactly once.

test.describe.configure({ mode: "serial" });

const OFFICIAL = "lead.judge@example.com";
const BUILD = process.env["DRONES_BUILD"];
const DEVICE: Record<string, string> = {
  android: "Pixel 7",
  iphone: "iPhone 15",
};

/** A new phone: its own storage, the project's device. */
async function phone(
  browser: Browser,
  info: TestInfo,
  options: BrowserContextOptions = {},
) {
  const device = devices[DEVICE[info.project.name] ?? "Pixel 7"];
  const context = await browser.newContext({
    ...device,
    baseURL: DRONES_URL,
    ...options,
  });
  return { context, page: await context.newPage() };
}

async function startJudging(
  page: Page,
  name: string,
  homeGroup?: string,
): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Name").fill(name);
  await page
    .getByLabel("Email")
    .fill(`${name.toLowerCase().replace(/\W+/g, ".")}@example.com`);
  if (homeGroup) await page.getByLabel(/^Your Troop/).fill(homeGroup);
  await page.getByRole("button", { name: "Start judging" }).click();
  await expect(page.getByText("Judging as")).toContainText(name);
}

const activity = (page: Page, title: string) =>
  page.getByRole("button", { name: title, exact: true });

async function fillClownCar(page: Page, clowns: string, flag: string) {
  await page.getByLabel("Big Top Cruiser Clowns").fill(clowns);
  await page.getByLabel("Patrol Flag").fill(flag);
  await page.getByRole("button", { name: "Save score" }).click();
}

const waitingToSend = (page: Page) =>
  page.getByRole("status", { name: "Waiting to send" });

/** The box, as an Official sees it over the API. */
async function box(request: APIRequestContext) {
  const get = async <T>(path: string): Promise<T> => {
    const res = await request.get(path, {
      headers: { "x-official-email": OFFICIAL },
    });
    expect(res.status(), path).toBe(200);
    return (await res.json()) as T;
  };
  const event = await get<{ activities: { id: string; title: string }[] }>(
    "/api/official/event",
  );
  const idOf = (title: string) => {
    const found = event.activities.find((a) => a.title === title);
    if (!found) throw new Error(`no Activity ${title}`);
    return found.id;
  };
  return {
    entries: async (title: string, team: string) =>
      (
        await get<{
          entries: {
            id: string;
            judge: { name: string; homeGroup?: string };
            entrant: { name: string | null };
            values: Record<string, unknown>;
            counts: boolean;
          }[];
        }>(`/api/official/activities/${idOf(title)}`)
      ).entries.filter((e) => e.entrant.name === team),
    closures: async (title: string) =>
      (
        await get<{
          closures: {
            judge: { name: string };
            scoreCount: number;
            missing: string[];
            scoredSince: number;
          }[];
        }>(`/api/official/activities/${idOf(title)}`)
      ).closures,
    teamsNamed: async (team: string) =>
      (await get<{ teams: { name: string }[] }>("/api/roster")).teams.filter(
        (t) => t.name === team,
      ).length,
  };
}

test("two Judges score one Patrol; the newer entry counts, and Officials see the home unit", async ({
  browser,
  request,
}, info) => {
  const tag = info.project.name;
  const troop = `Troop ${tag}`;
  const owls = `Owls ${tag}`;

  const alex = await phone(browser, info);
  await startJudging(alex.page, `Alex ${tag}`, "Troop 7");
  // The build under test, on the phone itself.
  if (BUILD) await expect(alex.page.getByText(`Build ${BUILD}`)).toBeVisible();
  await activity(alex.page, "Clown Car").click();
  await alex.page
    .getByRole("button", { name: "Patrol not listed? Add one" })
    .click();
  const groups = alex.page.getByRole("combobox");
  if (await groups.isVisible())
    await groups.selectOption({ label: "New Troop…" });
  await alex.page.getByLabel("New Troop name").fill(troop);
  await alex.page.getByLabel("Patrol name").fill(owls);
  await alex.page.getByRole("button", { name: "Add Patrol" }).click();
  await fillClownCar(alex.page, "8", "4");
  await expect(alex.page.getByText(/Score saved/)).toBeVisible();

  const sam = await phone(browser, info);
  await startJudging(sam.page, `Sam ${tag}`);
  await activity(sam.page, "Clown Car").click();
  await sam.page.getByRole("button", { name: `${owls} (${troop})` }).click();
  await fillClownCar(sam.page, "5", "3");
  await expect(sam.page.getByText(/Score saved/)).toBeVisible();

  const { entries, teamsNamed } = await box(request);
  expect(await teamsNamed(owls)).toBe(1);
  const scored = await entries("Clown Car", owls);
  expect(scored.map((e) => [e.judge.name, e.counts])).toEqual([
    [`Alex ${tag}`, false],
    [`Sam ${tag}`, true],
  ]);
  expect(scored[0]?.judge.homeGroup).toBe("Troop 7");

  // And in the Official view, in a browser.
  await alex.page.goto("/official");
  await alex.page.getByLabel("Email").fill(OFFICIAL);
  await alex.page.getByRole("button", { name: "Sign in" }).click();
  await alex.page.getByRole("button", { name: /Clown Car/ }).click();
  await expect(
    alex.page.getByText(`from Alex ${tag} (Troop 7)`).first(),
  ).toBeVisible();
  await alex.context.close();
  await sam.context.close();
});

test("with no network, the page opens from the phone after a reload; a Patrol added and scored there arrives once", async ({
  browser,
  request,
}, info) => {
  const tag = info.project.name;
  const hawks = `Hawks ${tag}`;
  const { context, page } = await phone(browser, info);
  await startJudging(page, `Casey ${tag}`);
  await activity(page, "Clown Car").click();
  await page
    .getByRole("button", { name: `Owls ${tag} (Troop ${tag})` })
    .waitFor();
  await expect
    .poll(
      () => page.evaluate(() => navigator.serviceWorker.controller !== null),
      {
        message:
          "the service worker never took charge of the page: is /sw.js served?",
        timeout: 15_000,
      },
    )
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("status").first()).toContainText(
    "using the event saved on this phone",
  );
  await page.getByRole("button", { name: "Back to Clown Car" }).click();
  await page
    .getByRole("button", { name: "Patrol not listed? Add one" })
    .click();
  await page.getByRole("combobox").selectOption({ label: `Troop ${tag}` });
  await page.getByLabel("Patrol name").fill(hawks);
  await page.getByRole("button", { name: "Add Patrol" }).click();
  await fillClownCar(page, "6", "2");
  await expect(page.getByText(/^Saved on this phone:/)).toBeVisible();
  await expect(waitingToSend(page)).toHaveText(/2 waiting to send/);

  await context.setOffline(false);
  await expect(waitingToSend(page)).toHaveCount(0, { timeout: 45_000 });
  const { entries, teamsNamed } = await box(request);
  expect(await teamsNamed(hawks)).toBe(1);
  expect(await entries("Clown Car", hawks)).toHaveLength(1);
  await context.close();
});

test("a reply lost on the way back is resent by the phone and counted once", async ({
  browser,
  request,
}, info) => {
  const tag = info.project.name;
  const owls = `Owls ${tag}`;
  // The page's own outbox does the resend; Playwright can only drop replies the service worker doesn't
  // carry, so this phone has none.
  const { context, page } = await phone(browser, info, {
    serviceWorkers: "block",
  });
  const before = (await (await box(request)).entries("Clown Car", owls)).length;
  await startJudging(page, `Dana ${tag}`);
  await activity(page, "Clown Car").click();
  let lost = false;
  await page.route("**/api/scores/*", async (route) => {
    if (lost) return route.continue();
    lost = true;
    await route.fetch(); // the box saves it
    await route.fulfill({ status: 503, json: { error: "no answer" } });
  });
  await page.getByRole("button", { name: `${owls} (Troop ${tag})` }).click();
  await fillClownCar(page, "7", "5");
  await expect(
    page.getByText(/^(Score saved|Saved on this phone):/),
  ).toBeVisible();
  await expect(waitingToSend(page)).toHaveCount(0, { timeout: 45_000 });
  expect(lost).toBe(true);
  expect(
    await (await box(request)).entries("Clown Car", owls),
    "the resend was counted as a second score",
  ).toHaveLength(before + 1);
  await context.close();
});

test("a stopwatch keeps running through a reload, and its time is what the box stores", async ({
  browser,
  request,
}, info) => {
  const tag = info.project.name;
  const owls = `Owls ${tag}`;
  const timeField = "Total elapsed time for 3 complete passes";
  const { context, page } = await phone(browser, info);
  await startJudging(page, `Eli ${tag}`);
  await activity(page, "3 Ring Circus").click();
  await page.getByRole("button", { name: `${owls} (Troop ${tag})` }).click();
  await page.getByRole("button", { name: `Start timer: ${timeField}` }).click();
  await page.waitForTimeout(2_200);

  await page.reload();
  await page.getByRole("button", { name: "Back to 3 Ring Circus" }).click();
  await expect(
    page.getByRole("button", { name: `${owls} (Troop ${tag})` }),
  ).toContainText("Draft");
  await page.getByRole("button", { name: `${owls} (Troop ${tag})` }).click();
  await expect(page.getByText("Picked up where you left off.")).toBeVisible();
  await page.getByRole("button", { name: `Stop timer: ${timeField}` }).click();
  const time = await page.getByLabel(timeField, { exact: true }).inputValue();
  expect(time).toMatch(/^0:0[2-9]$/);
  await page.getByRole("button", { name: "Save score" }).click();
  await expect(page.getByText(/Score saved/)).toBeVisible();

  const stored = await (await box(request)).entries("3 Ring Circus", owls);
  expect(stored.map((e) => e.values["elapsed_time"])).toEqual([time]);
  await context.close();
});

test("a Judge closes an Activity, and the box confirms it has their scores", async ({
  browser,
  request,
}, info) => {
  const tag = info.project.name;
  const owls = `Owls ${tag}`;
  const { context, page } = await phone(browser, info);
  await startJudging(page, `Fran ${tag}`);
  await activity(page, "Clown Car").click();
  await page.getByRole("button", { name: `${owls} (Troop ${tag})` }).click();
  await fillClownCar(page, "4", "4");
  await expect(page.getByText(/^Score saved:/)).toBeVisible();
  await page.getByRole("button", { name: "Score another Patrol" }).click();
  await page.getByRole("button", { name: "I'm done: close Clown Car" }).click();
  await expect(
    page.getByText("Closed. The box has your score at Clown Car."),
  ).toBeVisible();

  const closed = (await (await box(request)).closures("Clown Car")).filter(
    (c) => c.judge.name === `Fran ${tag}`,
  );
  expect(closed).toMatchObject([
    {
      judge: { name: `Fran ${tag}` },
      scoreCount: 1,
      missing: [],
      scoredSince: 0,
    },
  ]);
  await context.close();
});

// The box epoch (#66, ADR-0027): phones resend what a restore lost, and drop what a reset cleared.

/**
 * Ask drones-collator.sh to do something to the box, which a browser container can't: it writes the command
 * into a shared folder and waits for the script's answer (`backup`: answers the file's name; `restore`: stops
 * the box, runs restore-backup on that file, starts it again and waits until it answers).
 */
async function boxCommand(command: "backup" | "restore"): Promise<string> {
  const dir = process.env["DRONES_CTL"];
  if (!dir) throw new Error("DRONES_CTL is not set: run drones-collator.sh");
  rmSync(`${dir}/ack`, { force: true });
  writeFileSync(`${dir}/cmd.tmp`, command);
  renameSync(`${dir}/cmd.tmp`, `${dir}/cmd`);
  const until = Date.now() + 150_000;
  while (!existsSync(`${dir}/ack`)) {
    if (Date.now() > until) throw new Error(`the box never did: ${command}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const answer = readFileSync(`${dir}/ack`, "utf8").trim();
  rmSync(`${dir}/ack`, { force: true });
  if (answer.startsWith("fail")) throw new Error(`${command}: ${answer}`);
  return answer;
}

/** Score the Patrol at Clown Car on a phone that is on the Activity list or has just saved. */
async function scoreClownCar(
  page: Page,
  owls: string,
  troop: string,
  clowns: string,
) {
  const again = page.getByRole("button", { name: "Score another Patrol" });
  if (await again.isVisible()) await again.click();
  else await activity(page, "Clown Car").click();
  await page.getByRole("button", { name: `${owls} (${troop})` }).click();
  await fillClownCar(page, clowns, "1");
  await expect(page.getByText(/Score saved/)).toBeVisible();
}

/** Every score entry on the box, for one Judge (by name) when given. */
async function allEntries(request: APIRequestContext, judge?: string) {
  const headers = { "x-official-email": OFFICIAL };
  const event = (await (
    await request.get("/api/official/event", { headers })
  ).json()) as { activities: { id: string }[] };
  const found: { id: string; judge: { name: string } }[] = [];
  for (const a of event.activities) {
    const res = await request.get(`/api/official/activities/${a.id}`, {
      headers,
    });
    const body = (await res.json()) as { entries: typeof found };
    found.push(...body.entries);
  }
  return judge ? found.filter((e) => e.judge.name === judge) : found;
}

test("after the box is restored from an earlier backup, phones resend what it lost, and every score is there once", async ({
  browser,
  request,
}, info) => {
  const tag = info.project.name;
  const owls = `Owls ${tag}`;
  const troop = `Troop ${tag}`;
  const gus = `Gus ${tag}`;
  const hana = `Hana ${tag}`;
  const a = await phone(browser, info);
  const b = await phone(browser, info);
  await startJudging(a.page, gus);
  await startJudging(b.page, hana);

  await scoreClownCar(a.page, owls, troop, "1");
  await scoreClownCar(b.page, owls, troop, "2");
  await boxCommand("backup");
  // These reach the box after the backup, so the restore loses them.
  await scoreClownCar(a.page, owls, troop, "3");
  await scoreClownCar(b.page, owls, troop, "4");
  await expect(waitingToSend(a.page)).toHaveCount(0);
  await expect(waitingToSend(b.page)).toHaveCount(0);
  expect(await allEntries(request, gus)).toHaveLength(2);
  expect(await allEntries(request, hana)).toHaveLength(2);

  await boxCommand("restore");
  expect(
    await allEntries(request, gus),
    "the restore should have lost the later scores",
  ).toHaveLength(1);

  await a.page.reload();
  await b.page.reload();
  await expect(
    a.page.getByText(/The box was restored; resending 2 items/),
  ).toBeVisible();
  await expect(
    b.page.getByText(/The box was restored; resending 2 items/),
  ).toBeVisible();
  await expect
    .poll(async () => [
      (await allEntries(request, gus)).length,
      (await allEntries(request, hana)).length,
    ])
    .toEqual([2, 2]);
  // Settled: nothing is sent twice.
  await expect(waitingToSend(a.page)).toHaveCount(0);
  await a.page.waitForTimeout(1_500);
  expect(await allEntries(request, gus)).toHaveLength(2);
  expect(await allEntries(request, hana)).toHaveLength(2);
  await a.context.close();
  await b.context.close();
});

test("after a reset, phones drop what they kept and say so; only a new score reaches the box", async ({
  browser,
  request,
}, info) => {
  const tag = info.project.name;
  const owls = `Owls ${tag}`;
  const troop = `Troop ${tag}`;
  const ira = `Ira ${tag}`;
  const jo = `Jo ${tag}`;
  const a = await phone(browser, info);
  const b = await phone(browser, info);
  await startJudging(a.page, ira);
  await startJudging(b.page, jo);
  await scoreClownCar(a.page, owls, troop, "1");
  await scoreClownCar(b.page, owls, troop, "2");
  expect(await allEntries(request)).not.toHaveLength(0);

  const title = (
    (await (await request.get("/api/event")).json()) as {
      event: { title: string };
    }
  ).event.title;
  const reset = await request.post("/api/official/reset", {
    headers: { "x-official-email": OFFICIAL },
    data: { kind: "scores", confirm: title },
  });
  expect(reset.status()).toBe(200);
  expect(await allEntries(request)).toHaveLength(0);

  await a.page.reload();
  await b.page.reload();
  for (const page of [a.page, b.page]) {
    await expect(page.getByText(/The box was reset/)).toBeVisible();
  }
  await a.page.waitForTimeout(1_500);
  expect(await allEntries(request), "a reset score came back").toHaveLength(0);

  await scoreClownCar(a.page, owls, troop, "5");
  const after = await allEntries(request);
  expect(after.map((e) => e.judge.name)).toEqual([ira]);
  await a.context.close();
  await b.context.close();
});
