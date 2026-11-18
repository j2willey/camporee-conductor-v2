import { describe, expect, it } from "vitest";
import { v1FieldId, v1ScoreValues } from "./field-id.ts";
import { V1ImportError } from "./import-v1.ts";

describe("v1FieldId (#10)", () => {
  it("trims the trailing space v1's Composer left on some ids", () => {
    expect(v1FieldId("field_1778195167953 ")).toBe("field_1778195167953");
  });

  it("leaves a clean id as it is", () => {
    expect(v1FieldId("patrol_flag")).toBe("patrol_flag");
  });
});

describe("v1ScoreValues (#10)", () => {
  it("keys a v1 score payload by the same ids the transcode gave the fields", () => {
    expect(
      v1ScoreValues(
        { "field_1778199810679 ": 8, patrol_flag: 4 },
        "clown-car/t1",
      ),
    ).toEqual({ field_1778199810679: 8, patrol_flag: 4 });
  });

  it("refuses an entry where two keys become the same id, naming the entry and both keys", () => {
    const both = () =>
      v1ScoreValues({ field_1: 3, "field_1 ": 5 }, "clown-car/t1");
    expect(both).toThrow(V1ImportError);
    expect(both).toThrow(/clown-car\/t1/);
    expect(both).toThrow(/"field_1" and "field_1 "/);
  });
});
