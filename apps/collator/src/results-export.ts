import type { CheckedBundle } from "@camporee-conductor/cartridge";
import { strToU8, zipSync } from "fflate";
import type { Db } from "./db/open.ts";
import { scoreEntries } from "./db/schema.ts";
import { officialAwards, type AwardsView } from "./awards.ts";
import { finalExhibitions, latestRows } from "./exhibition-results.ts";
import { officialActivity, officialEvent } from "./official-view.ts";
import { judgeList } from "./roster-and-scores.ts";
import { officialStandings } from "./standings.ts";

// The awards CSV and the results export (#43 PR 6, ADR-0027). Nothing is computed here: every file is a view the
// Official pages already show, written out as rows (CLAUDE.md rule 3). Judges' emails leave the box only in
// judges.csv of the zip.

type Cell = string | number | boolean | null | undefined;

const BOM = "﻿";

/**
 * CSV for a spreadsheet: a byte-order mark first (Excel reads UTF-8 by it), CRLF after every row, null and
 * undefined empty, a boolean "yes" or "no" (so an unticked box isn't mistaken for an unanswered one). A cell is
 * quoted when it has a comma, quote, CR, LF or an edge space. A text cell starting `=`, `+`, `-`, `@`, tab or CR
 * gets a leading `'` so a name typed on a phone isn't run as a formula; numbers are never guarded.
 */
export function csvText(rows: Cell[][]): string {
  const cell = (value: Cell): string => {
    if (value === null || value === undefined) return "";
    if (typeof value === "boolean") return value ? "yes" : "no";
    let text = String(value);
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) {
      text = `'${text}`;
    }
    return /[,"\r\n]|^ | $/.test(text)
      ? `"${text.replaceAll('"', '""')}"`
      : text;
  };
  return BOM + rows.map((r) => r.map(cell).join(",") + "\r\n").join("");
}

/** The Event's names for a Group and a Team (e.g. Troop, Patrol), as the judge page and printouts show them. */
function entrantLabels(bundle: CheckedBundle): [string, string] {
  const labels = bundle.event.terminology.labels;
  return [labels?.group ?? "Group", labels?.team ?? "Team"];
}

/** The box's local date, YYYY-MM-DD. */
function localDate(now: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/** An id as a file name: lowercase, anything but a-z 0-9 _ - becomes -. */
function fileId(id: string): string {
  return id.toLowerCase().replaceAll(/[^a-z0-9_-]/g, "-");
}

export function awardsCsv(
  db: Db,
  bundle: CheckedBundle,
  now: Date,
  view: AwardsView = officialAwards(db, bundle),
): { fileName: string; text: string } {
  // Single-line text `info` fields of each winning Activity (a notes area isn't one): label -> field id, per
  // Activity, looked up once from the Official view's merged fields. Columns are the union by label.
  const valuesAt = new Map<string, Map<string, unknown>>();
  const columns: string[] = [];
  const perActivity = new Map<string, Map<string, string>>();
  for (const section of view.sections) {
    for (const group of section.groups) {
      if (group.kind !== "activity" || perActivity.has(group.id)) continue;
      const activity = officialActivity(db, bundle, group.id);
      const labels = new Map<string, string>();
      for (const f of activity?.fields ?? []) {
        if (f.type === "text" && f.kind === "info") {
          labels.set(f.label, f.id);
          if (!columns.includes(f.label)) columns.push(f.label);
        }
      }
      perActivity.set(group.id, labels);
      for (const row of activity?.matrix ?? []) {
        valuesAt.set(
          `${group.id}\n${row.entrantId}`,
          new Map(Object.entries(row.values ?? {})),
        );
      }
    }
  }
  const rows: Cell[][] = [
    [
      "Competition",
      "Category",
      "Place",
      ...entrantLabels(bundle),
      "Score",
      "Manual",
      "Name",
      "Notes",
      ...columns,
    ],
  ];
  for (const { competition, groups } of view.sections) {
    for (const group of groups) {
      if (group.kind === "exhibition") {
        for (const r of group.rows) {
          rows.push([
            competition.label,
            group.title,
            r.place,
            r.group,
            r.team,
            null,
            null,
            r.participantName,
            r.notes,
            ...columns.map(() => null),
          ]);
        }
        continue;
      }
      const labels = perActivity.get(group.id);
      for (const line of group.lines) {
        const values = valuesAt.get(`${group.id}\n${line.entrantId}`);
        rows.push([
          competition.label,
          group.title,
          line.place ?? line.rank,
          line.entrant.group,
          line.entrant.team,
          line.total,
          line.manual,
          null,
          null,
          ...columns.map((label) => {
            const id = labels?.get(label);
            const v = id === undefined ? undefined : values?.get(id);
            return v === undefined ? null : (v as Cell);
          }),
        ]);
      }
    }
  }
  const stem = view.provisional ? "awards-provisional" : "awards";
  return {
    fileName: `${stem}-${localDate(now)}.csv`,
    text: csvText(rows),
  };
}

export function resultsZip(
  db: Db,
  bundle: CheckedBundle,
  now: Date,
): { fileName: string; bytes: Uint8Array } {
  const view = officialAwards(db, bundle);
  const [groupLabel, teamLabel] = entrantLabels(bundle);
  const files: Record<string, string> = {};
  const listed = officialEvent(db, bundle).activities;
  const entrantCells = (
    level: "team" | "group" | undefined,
    e: { name: string | null; group: string | null },
  ): [string | null, string | null] =>
    level === "group" ? [e.name, null] : [e.group, e.name];

  files["awards.csv"] = awardsCsv(db, bundle, now, view).text;

  for (const s of officialStandings(db, bundle)) {
    files[`standings/${fileId(s.competition.id)}.csv`] = csvText([
      [
        "Rank",
        groupLabel,
        teamLabel,
        "Total",
        "Disqualified",
        ...s.activities.map((a) => a.title),
      ],
      ...s.rows.map((r) => [
        r.rank,
        ...entrantCells(s.competition.level, r.entrant),
        r.total,
        r.disqualified,
        ...s.activities.map((a) => r.points[a.id] ?? null),
      ]),
    ]);
  }

  const entryRows: Cell[][] = [
    [
      "Activity",
      "Entry id",
      "Received #",
      "Phone time",
      "Judge",
      "Judge's unit",
      groupLabel,
      teamLabel,
      "Counts",
      "Values",
    ],
  ];
  for (const a of listed) {
    if (a.scoringType !== "ranked") continue;
    const activity = officialActivity(db, bundle, a.id);
    if (!activity) continue;
    const level = a.competition.level;
    files[`scores/${fileId(a.id)}.csv`] = csvText([
      [
        "Place",
        groupLabel,
        teamLabel,
        "On roster",
        "Total",
        "Points",
        "Disqualified",
        "Judge",
        "Judge's unit",
        "Received at",
        "Entries",
        ...activity.fields.map((f) => f.label),
      ],
      ...activity.matrix.map((m) => [
        m.place,
        ...entrantCells(level, m.entrant),
        m.onRoster,
        m.total,
        m.points,
        m.disqualified,
        m.judge?.name,
        m.judge?.homeGroup,
        m.receivedAt,
        m.entryCount,
        ...activity.fields.map((f) => m.values?.[f.id] ?? null),
      ]),
    ]);
    for (const e of activity.entries) {
      entryRows.push([
        a.title,
        e.id,
        e.receivedSeq,
        e.phoneCreatedAt,
        e.judge.name,
        e.judge.homeGroup,
        ...entrantCells(level, e.entrant),
        e.counts,
        JSON.stringify(e.values),
      ]);
    }
  }
  files["entries.csv"] = csvText(entryRows);

  const finals = finalExhibitions(db);
  for (const a of listed) {
    if (a.scoringType !== "exhibition") continue;
    const status = finals.has(a.id) ? "final" : "draft";
    files[`exhibitions/${fileId(a.id)}.csv`] = csvText([
      ["Status", "Name", groupLabel, teamLabel, "Place", "Notes"],
      ...latestRows(db, a.id).map((r) => [
        status,
        r.participantName,
        r.group,
        r.team,
        r.place,
        r.notes,
      ]),
    ]);
  }

  const sent = new Map<string, number>();
  for (const e of db.select().from(scoreEntries).all()) {
    sent.set(e.judgeId, (sent.get(e.judgeId) ?? 0) + 1);
  }
  files["judges.csv"] = csvText([
    ["Name", "Email", "Home unit", "Entries"],
    ...judgeList(db).map((j) => [
      j.name,
      j.email,
      j.homeGroup,
      sent.get(j.id) ?? 0,
    ]),
  ]);

  const names = [...Object.keys(files), "README.txt"];
  files["README.txt"] = [
    `${bundle.event.title}: results export`,
    `Exported at ${now.toISOString()}`,
    view.provisional
      ? `Results were PROVISIONAL when exported: ${view.finalizedCount} of ${view.rankedCount} ranked Activities final, ${view.exhibitionFinalCount} of ${view.exhibitionCount} Exhibitions final.`
      : "All results final.",
    "",
    "Files:",
    ...names.map((n) => `  ${n}`),
    "",
    "judges.csv holds Judges' emails: keep this file private; it's for thank-you notes.",
    "",
  ].join("\r\n");

  const bytes = zipSync(
    Object.fromEntries(Object.entries(files).map(([n, t]) => [n, strToU8(t)])),
    { mtime: now },
  );
  const stem = view.provisional ? "results-provisional" : "results";
  return { fileName: `${stem}-${localDate(now)}.zip`, bytes };
}
