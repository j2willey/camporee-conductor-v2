import { readFileSync } from "node:fs";
import {
  ActivitySchema,
  CommonFieldSetSchema,
  EventSchema,
} from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import { judgeFormFields } from "./fields-for.ts";

const fixture = (path: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../schema/fixtures/circus-2026/${path}`, import.meta.url),
      "utf8",
    ),
  );
const event = EventSchema.parse(fixture("event.json"));
const sets = [CommonFieldSetSchema.parse(fixture("common-fields.json"))];
const clownCar = ActivitySchema.parse(fixture("activities/clown-car.json"));
const competitionOf = (activityId: string) => {
  const listed = event.activities.find((a) => a.activityId === activityId);
  const found = event.competitions.find((c) => c.id === listed?.competitionId);
  if (!found) throw new Error("no Competition");
  return found;
};

describe("judgeFormFields", () => {
  it("is the judge's form: Common Fields before and after, variables filled, Judge fields only", () => {
    const fields = judgeFormFields(clownCar, competitionOf(clownCar.id), sets);
    const own = clownCar.scoring.fields
      .filter((f) => f.audience === "judge")
      .map((f) => f.id);
    expect(fields.map((f) => f.id)).toEqual([
      "p_flag",
      "p_yell",
      "p_spirit",
      "ten_ess",
      ...own,
      "unscout",
      "off_notes",
    ]);
    expect(fields.find((f) => f.id === "ten_ess")?.label).toBe(
      "10 Essentials: Buddy",
    );
    expect(fields[0]).toEqual({
      id: "p_flag",
      label: "Patrol Flag",
      type: expect.any(String),
      required: expect.any(Boolean),
      config: expect.any(Object),
    });
  });

  it("leaves out Official fields", () => {
    const withOfficial = {
      ...clownCar,
      scoring: {
        fields: [
          ...clownCar.scoring.fields,
          {
            ...clownCar.scoring.fields[0],
            id: "official_only",
            audience: "official" as const,
          },
        ],
      },
    } as typeof clownCar;
    const ids = judgeFormFields(
      withOfficial,
      competitionOf(clownCar.id),
      sets,
    ).map((f) => f.id);
    expect(ids).not.toContain("official_only");
  });
});
