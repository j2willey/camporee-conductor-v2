import type { FormField } from "./field.ts";
import { describe, expect, it } from "vitest";
import { initialEntry, readEntry } from "./form.ts";

const field = (
  id: string,
  type: FormField["type"],
  extra: Partial<FormField> = {},
): FormField => ({
  id,
  label: id,
  type,
  required: false,
  config: {},
  ...extra,
});

describe("initialEntry", () => {
  it("starts from each field's default, as text the inputs can show", () => {
    expect(
      initialEntry([
        field("a", "number", { config: { defaultValue: 6 } }),
        field("b", "number"),
        field("c", "checkbox", { config: { defaultValue: true } }),
        field("d", "checkbox"),
      ]),
    ).toEqual({ a: "6", b: "", c: true, d: false });
  });
});

describe("readEntry: what the Judge typed → the score's values", () => {
  it("reads numbers, keeps text as typed (trimmed), and leaves blanks out", () => {
    const fields = [
      field("count", "number"),
      field("time", "stopwatch"),
      field("notes", "textarea"),
      field("blank", "number"),
      field("pick", "select", { config: { options: ["Red", "Blue"] } }),
      field("ok", "checkbox"),
    ];
    expect(
      readEntry(fields, {
        count: "7",
        time: " 1:23 ",
        notes: "  good  ",
        blank: "",
        pick: "Blue",
        ok: true,
      }),
    ).toEqual({
      ok: true,
      values: { count: 7, time: "1:23", notes: "good", pick: "Blue", ok: true },
    });
  });

  it("says which required fields are blank", () => {
    const result = readEntry(
      [field("flag", "number", { label: "Patrol Flag", required: true })],
      { flag: " " },
    );
    expect(result).toEqual({
      ok: false,
      problems: ["Patrol Flag is required"],
    });
  });

  it("refuses a select value that isn't one of its options, as the box does", () => {
    const result = readEntry(
      [
        field("pick", "select", {
          label: "Costume",
          config: { options: ["Red", "Blue"] },
        }),
      ],
      { pick: "Green" },
    );
    expect(result).toEqual({
      ok: false,
      problems: ["Costume must be one of the listed options"],
    });
  });

  it("takes a required checkbox left unticked as a value", () => {
    expect(
      readEntry([field("ok", "checkbox", { required: true })], { ok: false }),
    ).toEqual({ ok: true, values: { ok: false } });
  });

  it("refuses a number outside the field's range, or not a number", () => {
    const result = readEntry(
      [
        field("flag", "number", {
          label: "Patrol Flag",
          config: { min: 0, max: 5 },
        }),
        field("yell", "number", { label: "Patrol Yell" }),
      ],
      { flag: "6", yell: "lots" },
    );
    expect(result).toEqual({
      ok: false,
      problems: [
        "Patrol Flag must be from 0 to 5",
        "Patrol Yell must be a number",
      ],
    });
  });
});
