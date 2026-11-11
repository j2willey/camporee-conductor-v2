import type {
  JudgeField,
  JudgeLabels,
} from "@camporee-conductor/collator/types";

// Paper scoresheets (#43 PR 5, ADR-0027): pure display helpers. The fields arrive already merged with the
// Competition's Common Fields by packages/scoring (the judge view); nothing is merged or ranked here.

export type SheetField = Pick<JudgeField, "id" | "label" | "type" | "config">;

export interface SheetColumn {
  key: string;
  label: string;
  /** A small line under the label: the range, "m:ss", and so on. */
  hint: string;
  /** Pixels, as v1's fieldWidth; absent means the column takes what is left. */
  width?: number;
}

/** What goes under a column heading to say what to write (v1's fieldHint). */
export function fieldHint(field: Pick<SheetField, "type" | "config">): string {
  const { min, max, options } = field.config;
  switch (field.type) {
    case "number":
      if (min !== undefined && max !== undefined) return `${min}–${max}`;
      if (max !== undefined) return `max ${max}`;
      if (min !== undefined) return `min ${min}`;
      return "";
    case "stopwatch":
      return "m:ss";
    case "checkbox":
      return "✓ / ✗";
    case "select":
      return (options ?? []).join(" / ");
    case "textarea":
      return "notes";
    default:
      return "";
  }
}

/** v1's fieldWidth, in pixels. */
function fieldWidth(type: SheetField["type"]): number {
  switch (type) {
    case "textarea":
      return 120;
    case "stopwatch":
      return 58;
    case "select":
      return 80;
    default:
      return 52;
  }
}

/**
 * The entrants first, then blank rows (`null`): at least `minRows` in all, and always at least 3 blank
 * rows after the entrants, for walk-ups.
 */
export function sheetRows<T>(
  entrants: readonly T[],
  minRows: number,
): (T | null)[] {
  const total = Math.max(minRows, entrants.length + 3);
  return [...entrants, ...Array<null>(total - entrants.length).fill(null)];
}

/** A sheet's columns: what a Judge enters on the phone, or the Exhibition results columns. */
export function sheetColumns(
  activity: {
    scoringType: "ranked" | "exhibition";
    level: "team" | "group";
    fields: readonly SheetField[];
  },
  labels: JudgeLabels,
): SheetColumn[] {
  const num: SheetColumn = { key: "#", label: "#", hint: "", width: 24 };
  const group: SheetColumn = {
    key: "group",
    label: labels.group,
    hint: "",
    width: 90,
  };
  const team: SheetColumn = {
    key: "team",
    label: labels.team,
    hint: "",
    width: 130,
  };
  if (activity.scoringType === "exhibition") {
    return [
      num,
      { key: "name", label: "Name", hint: "" },
      group,
      team,
      { key: "place", label: "Place", hint: "", width: 52 },
      { key: "notes", label: "Notes", hint: "" },
    ];
  }
  return [
    num,
    group,
    ...(activity.level === "team" ? [team] : []),
    ...activity.fields.map((f) => ({
      key: f.id,
      label: f.label,
      hint: fieldHint(f),
      width: fieldWidth(f.type),
    })),
  ];
}

/** Each sheet twice, in order, for two-sided printing. */
export function withDuplex<T>(sheets: readonly T[]): T[] {
  return sheets.flatMap((s) => [s, s]);
}

/** The rows a sheet has at least, from the Rows box as typed: 5–60, and v1's 20 when it's empty or unreadable. */
export function rowCount(typed: string): number {
  const n = Math.trunc(Number(typed));
  if (typed.trim() === "" || !Number.isFinite(n)) return 20;
  return Math.min(60, Math.max(5, n));
}
