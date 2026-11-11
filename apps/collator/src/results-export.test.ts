import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { Db } from "./db/open.ts";
import { OFFICIAL_EMAIL_HEADER } from "./headers.ts";
import { loadedEvent, loadEventCartridge } from "./load-event.ts";
import { awardsCsv, csvText, resultsZip } from "./results-export.ts";
import {
  circusCartridge,
  CLOWN_CAR,
  DIRECTOR_EMAIL,
  editFields,
  testDb,
} from "./test-support.ts";

// The awards CSV and the results export (#43 PR 6, ADR-0027): views already on the Official pages, laid out as CSV.

const BOM = "\uFEFF";
/** Decoded keeping the byte-order mark, which a plain decode drops. */
const text = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
const ALEX = {
  id: "judge-alex",
  name: "Alex Judge",
  email: "alex@example.com",
};
const SAM = {
  id: "judge-sam",
  name: "Sam Judge",
  email: "sam@example.com",
  homeGroup: "Troop 7",
};
const NOW = new Date(2027, 4, 15, 14, 0, 0);
const DISH = "Dish Name / Description";

let db: Db;
let app: ReturnType<typeof createApp>;

const put = (path: string, body: unknown) =>
  app.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const bundle = () => {
  const b = loadedEvent(db)?.bundle;
  if (!b) throw new Error("no Event");
  return b;
};

beforeEach(async () => {
  db = testDb();
  app = createApp({ db });
  const result = loadEventCartridge(
    db,
    circusCartridge({
      editActivity: editFields(CLOWN_CAR.id, (fields) => [
        ...fields,
        {
          id: "dish",
          label: DISH,
          type: "text",
          kind: "info",
          audience: "judge",
          sortOrder: 999,
          weight: 1,
        },
        {
          id: "side_notes",
          label: "Side notes",
          type: "textarea",
          kind: "info",
          audience: "judge",
          sortOrder: 1000,
          weight: 1,
        },
      ]),
    }),
  );
  if (!result.ok) throw new Error(result.issues.join("\n"));
  await put("/api/groups/group-1", { name: "Troop 101" });
  await put("/api/teams/team-1", { groupId: "group-1", name: "=SUM(A1)" });
  await put("/api/teams/team-2", { groupId: "group-1", name: "Owls, the" });
  const score = (
    id: string,
    judge: typeof ALEX | typeof SAM,
    team: string,
    n: number,
    dish: string,
  ) =>
    put(`/api/scores/${id}`, {
      judge,
      activityId: CLOWN_CAR.id,
      entrantId: team,
      values: {
        [CLOWN_CAR.ownField]: n,
        [CLOWN_CAR.commonField]: 5,
        dish,
        side_notes: "long note",
      },
      phoneCreatedAt: "2027-05-15T09:30:00Z",
    });
  await score("score-1", ALEX, "team-1", 9, "Stew");
  await score("score-2", ALEX, "team-2", 3, "Pie");
  await score("score-3", SAM, "team-2", 4, "Cake");
});

describe("csvText", () => {
  it("starts with a byte-order mark and ends every row, the last too, with CRLF", () => {
    expect(
      csvText([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe(`${BOM}a,b\r\nc,d\r\n`);
  });

  it("writes null and undefined as empty, numbers as typed, booleans as yes or blank", () => {
    expect(csvText([[null, undefined, 3, -3, 0.5, true, false]])).toBe(
      `${BOM},,3,-3,0.5,yes,\r\n`,
    );
  });

  it("quotes a cell with a comma, quote, CR, LF or edge space, doubling inner quotes", () => {
    expect(
      csvText([["a,b", 'say "hi"', "x\ny", "x\ry", " lead", "trail "]]),
    ).toBe(`${BOM}"a,b","say ""hi""","x\ny","x\ry"," lead","trail "\r\n`);
  });

  it("guards a text cell that starts like a formula, but never a number", () => {
    expect(
      csvText([["=SUM(A1)", "+1", "-1", "@x", "\tx", "\rx", "ok", -3]]),
    ).toBe(`${BOM}'=SUM(A1),'+1,'-1,'@x,'\tx,"'\rx",ok,-3\r\n`);
  });
});

describe("awardsCsv", () => {
  it("has the header, one row per line in the view's order, entry-name columns, and guards names", () => {
    const { fileName, text } = awardsCsv(db, bundle(), NOW);
    expect(fileName).toBe("awards-provisional-2027-05-15.csv");
    const lines = text.slice(1).split("\r\n");
    expect(lines[0]).toBe(
      `Competition,Category,Place,Group,Team,Score,Manual,Name,Notes,${DISH}`,
    );
    const clownRows = lines.filter((l) => l.includes("Troop 101"));
    expect(clownRows.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain(",'=SUM(A1),");
    expect(text).not.toContain(",=SUM(A1),");
    // Place is the rank for an Activity line; the dish is read from the score matrix (the newest entry counts).
    expect(
      lines.some((l) => l.includes("Troop 101") && l.endsWith(",Stew")),
    ).toBe(true);
    expect(lines.some((l) => l.includes("Owls") && l.endsWith(",Cake"))).toBe(
      true,
    );
    expect(text).not.toContain("Side notes");
    expect(lines.at(-1)).toBe("");
  });
});

describe("resultsZip", () => {
  const unzip = (bytes: Uint8Array) =>
    Object.fromEntries(
      Object.entries(unzipSync(bytes)).map(([k, v]) => [k, text(v)]),
    );

  it("holds the files, with the Judges' emails and a provisional README", () => {
    const { fileName, bytes } = resultsZip(db, bundle(), NOW);
    expect(fileName).toBe("results-provisional-2027-05-15.zip");
    const files = unzip(bytes);
    const names = Object.keys(files);
    expect(names).toEqual(
      expect.arrayContaining([
        "awards.csv",
        "entries.csv",
        "judges.csv",
        "README.txt",
      ]),
    );
    expect(names.some((n) => n.startsWith("standings/"))).toBe(true);
    expect(names).toContain(`scores/${CLOWN_CAR.id}.csv`);
    expect(names.some((n) => n.startsWith("exhibitions/"))).toBe(true);
    for (const n of names) {
      expect(n).toMatch(/^[A-Za-z0-9_\-./]+$/);
      if (n.endsWith(".csv")) expect(files[n]?.startsWith(BOM)).toBe(true);
    }
    expect(files["judges.csv"]).toBe(
      `${BOM}Name,Email,Home unit,Entries\r\nAlex Judge,alex@example.com,,2\r\nSam Judge,sam@example.com,Troop 7,1\r\n`,
    );
    expect(
      files["awards.csv"]?.slice(1).startsWith("Competition,Category,Place,"),
    ).toBe(true);
    const readme = files["README.txt"] ?? "";
    expect(readme).toContain("PROVISIONAL");
    expect(readme).toContain(
      "judges.csv holds Judges' emails: keep this file private",
    );
    expect(files["entries.csv"]?.split("\r\n")[0]).toBe(
      `${BOM}Activity,Entry id,Received #,Phone time,Judge,Judge's unit,Group,Team,Counts,Values`,
    );
    expect(files["entries.csv"]).toContain("score-3");
    expect(files[`scores/${CLOWN_CAR.id}.csv`]?.split("\r\n")[0]).toMatch(
      /^\uFEFFPlace,Group,Team,On roster,Total,Points,Disqualified,Judge,Judge's unit,Received at,Entries,/,
    );
    const standing = Object.entries(files).find(([n]) =>
      n.startsWith("standings/"),
    );
    expect(standing?.[1].split("\r\n")[0]).toMatch(
      /^\uFEFFRank,Group,Team,Total,Disqualified/,
    );
  });

  it("lists an Exhibition with its status", () => {
    const archery = bundle().activities.find(
      (a) => a.scoringType === "exhibition",
    );
    if (!archery) throw new Error("no Exhibition");
    const files = unzip(resultsZip(db, bundle(), NOW).bytes);
    const csv = files[`exhibitions/${archery.id}.csv`];
    expect(csv?.split("\r\n")[0]).toBe(
      `${BOM}Status,Name,Group,Team,Place,Notes`,
    );
  });

  it("says All results final only when every Activity and Exhibition is", () => {
    const readme =
      unzip(resultsZip(db, bundle(), NOW).bytes)["README.txt"] ?? "";
    expect(readme).toMatch(
      /of \d+ ranked Activities final, \d+ of \d+ Exhibitions final/,
    );
  });
});

describe("the export routes", () => {
  const get = (path: string, email: string | null = DIRECTOR_EMAIL) =>
    app.request(path, {
      headers: email === null ? {} : { [OFFICIAL_EMAIL_HEADER]: email },
    });

  it("serve the awards CSV as an attachment", async () => {
    const res = await get("/api/official/export/awards.csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="awards-provisional-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(
      text(new Uint8Array(await res.arrayBuffer())).startsWith(
        `${BOM}Competition,Category,Place`,
      ),
    ).toBe(true);
  });

  it("serve the results zip as an attachment", async () => {
    const res = await get("/api/official/export/results.zip");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="results-provisional-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files)).toContain("judges.csv");
  });

  it("need the Official gate: 401 with no email, 403 for someone not on the list", async () => {
    for (const path of [
      "/api/official/export/awards.csv",
      "/api/official/export/results.zip",
    ]) {
      expect((await get(path, null)).status).toBe(401);
      expect((await get(path, "alex@example.com")).status).toBe(403);
    }
  });
});
