import {
  CommonFieldSetSchema,
  EventSchema,
  type CommonFieldSet,
  type Event,
} from "@camporee-conductor/schema";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  inUseMissing,
  moveCommonField,
  placeCommonField,
  placementOf,
  variablesUsed,
} from "./common-fields.ts";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../packages/schema/fixtures/circus-2026/${name}`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
const circus = fixture("event.json") as Event;
const SET = fixture("common-fields.json") as CommonFieldSet;
const [games, exhibition] = circus.competitions;
if (!games || !exhibition) throw new Error("fixture changed");

describe("placing a Common Field in a Competition", () => {
  it("says where a field is: before, after or not used", () => {
    expect(placementOf(games, "p_yell")).toBe("before");
    expect(placementOf(games, "unscout")).toBe("after");
    expect(placementOf(exhibition, "p_yell")).toBeNull();
  });

  it("moves a field to the end of the other list", () => {
    const next = placeCommonField(games, SET.id, "p_flag", "after");
    expect(next.commonFields).toEqual({
      setId: SET.id,
      before: ["p_yell", "p_spirit", "ten_ess"],
      after: ["unscout", "off_notes", "p_flag"],
    });
  });

  it("takes a field off, and keeps the link to the set when nothing is left", () => {
    let next = games;
    for (const id of [
      "p_flag",
      "p_yell",
      "p_spirit",
      "ten_ess",
      "unscout",
      "off_notes",
    ]) {
      next = placeCommonField(next, SET.id, id, null);
    }
    expect(next.commonFields).toEqual({ setId: SET.id, before: [], after: [] });
  });

  it("links a Competition with no Common Fields to the set", () => {
    const next = placeCommonField(exhibition, SET.id, "unscout", "after");
    expect(next.commonFields).toEqual({
      setId: SET.id,
      before: [],
      after: ["unscout"],
    });
    expect(placeCommonField(exhibition, SET.id, "unscout", null)).toBe(
      exhibition,
    );
  });

  it("reorders within a list, unchanged at either end", () => {
    expect(moveCommonField(games, "before", 0, 1).commonFields?.before).toEqual(
      ["p_yell", "p_flag", "p_spirit", "ten_ess"],
    );
    expect(moveCommonField(games, "after", 1, 1).commonFields?.after).toEqual([
      "unscout",
      "off_notes",
    ]);
  });

  it("keeps the Event valid", () => {
    const event = {
      ...circus,
      competitions: [
        placeCommonField(games, SET.id, "p_flag", "after"),
        placeCommonField(exhibition, SET.id, "unscout", "after"),
        ...circus.competitions.slice(2),
      ],
    };
    expect(EventSchema.safeParse(event).success).toBe(true);
  });
});

describe("editing the set", () => {
  it("names each Competition still using a field the set no longer has", () => {
    const ids = SET.fields.map((f) => f.id).filter((id) => id !== "ten_ess");
    expect(inUseMissing(circus, ids)).toEqual([
      "Patrol Games uses ten_ess. Take it off on the Competitions page first, or put the field back.",
    ]);
    expect(
      inUseMissing(
        circus,
        SET.fields.map((f) => f.id),
      ),
    ).toEqual([]);
  });

  it("lists the {{variables}} its labels and placeholders use, once each, in order", () => {
    const [first, second] = SET.fields;
    if (!first || !second) throw new Error("fixture changed");
    expect(variablesUsed(SET.fields)).toEqual(["ten_essentials"]);
    expect(
      variablesUsed([
        { ...first, label: "{{ b }} and {{a}}" },
        {
          ...second,
          label: "x",
          config: { placeholder: "{{a}} {{c}}" },
        },
      ]),
    ).toEqual(["b", "a", "c"]);
  });

  it("the fixture set is valid as read", () => {
    expect(CommonFieldSetSchema.safeParse(SET).success).toBe(true);
  });
});
