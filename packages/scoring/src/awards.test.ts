import type { Award } from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import { loadCircus2026AsRun } from "../scripts/circus-2026-as-run.ts";
import {
  awardRecipients,
  scoreEvent,
  withinCutoff,
  type OfficialAction,
  type RankedStanding,
} from "./index.ts";
import { COMPETITION, smallEvent } from "./test-support.ts";

const AWARD = "0196cfa2-4c00-7000-8000-000000000030";

function award(rule: Award["rule"], scope: Award["scope"] = "event"): Award {
  return {
    id: AWARD,
    slug: "the-award",
    label: "The Award",
    competitionId: COMPETITION,
    scope,
    rule,
  };
}

/** Standings with these ranks, entrants t1, t2… (DQ comes from `disqualify` actions, below). */
function standings(ranks: number[]): RankedStanding[] {
  return ranks.map((rank, i) => ({
    entrantId: `t${i + 1}`,
    total: 1000 - rank,
    rank,
    disqualified: false,
  }));
}

/** Just the recipients, for tests that log only valid actions. */
const recipients = (...args: Parameters<typeof awardRecipients>) =>
  awardRecipients(...args).recipients;

const dq = (entrantId: string): OfficialAction => ({
  type: "disqualify",
  entrantId,
  disqualified: true,
});

/** The Award's recipients when scoreEvent runs a small Event with one Activity scored `scores`. */
function recipientsOf(
  rule: Award["rule"],
  scores: Record<string, number>,
  actions: OfficialAction[],
) {
  const input = smallEvent({
    scores: [scores],
    awards: [{ ...award(rule), competitionId: COMPETITION }],
    actions,
  });
  return scoreEvent(input).awards[0]?.recipients ?? [];
}

const setAward = (
  entrantId: string,
  awarded: boolean,
  awardId = AWARD,
): OfficialAction => ({ type: "set-award", awardId, entrantId, awarded });

const AXES = award({ type: "places", names: ["Gold Axe", "Silver Hatchet"] });
const TOP_25 = award({ type: "top-percent", percent: 25 });

describe("named places go by place number (ADR-0019 Awards amendment)", () => {
  it("dense 1, 1, 2, 3: two Gold Axes and a Silver Hatchet", () => {
    expect(recipients(AXES, standings([1, 1, 2, 3]), [])).toEqual([
      { entrantId: "t1", place: "Gold Axe", manual: false },
      { entrantId: "t2", place: "Gold Axe", manual: false },
      { entrantId: "t3", place: "Silver Hatchet", manual: false },
    ]);
  });

  it("strict 1, 1, 3: two Gold Axes and no Silver Hatchet", () => {
    expect(recipients(AXES, standings([1, 1, 3]), [])).toEqual([
      { entrantId: "t1", place: "Gold Axe", manual: false },
      { entrantId: "t2", place: "Gold Axe", manual: false },
    ]);
  });
});

describe("top-percent is a counted cutoff, ties at the line included", () => {
  it("rounds the count up: 25% of 10 entrants is 3", () => {
    const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(
      recipients(TOP_25, standings(ranks), []).map((r) => r.entrantId),
    ).toEqual(["t1", "t2", "t3"]);
  });

  it("uses withinCutoff, so a tie at the line takes everyone tied", () => {
    const ranked = standings([
      1, 2, 3, 4, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    const winners = recipients(TOP_25, ranked, []);
    expect(winners.map((r) => r.entrantId)).toEqual(
      withinCutoff(ranked, 4).map((s) => s.entrantId),
    );
    expect(winners).toHaveLength(5);
  });
});

describe("overall DQ: removed before ranking, so no automatic award (ADR-0019 DQ amendment)", () => {
  it("named places: standings 1, 2, 3 with 1st DQ'd → t2 gets the Gold Axe, t3 the Silver Hatchet", () => {
    expect(
      recipientsOf(AXES.rule, { t1: 30, t2: 20, t3: 10 }, [dq("t1")]),
    ).toEqual([
      { entrantId: "t2", place: "Gold Axe", manual: false },
      { entrantId: "t3", place: "Silver Hatchet", manual: false },
    ]);
  });

  it("named places: with t1 and t2 tied 1st and t1 DQ'd, t2 is 1st alone and t3 moves up to 2nd", () => {
    expect(
      recipientsOf(AXES.rule, { t1: 30, t2: 30, t3: 20 }, [dq("t1")]),
    ).toEqual([
      { entrantId: "t2", place: "Gold Axe", manual: false },
      { entrantId: "t3", place: "Silver Hatchet", manual: false },
    ]);
  });

  it("top-percent counts only entrants who aren't DQ'd: 9 entrants, 1 DQ'd → 25% of 8 = 2", () => {
    const scores = Object.fromEntries(
      [90, 80, 70, 60, 50, 40, 30, 20, 10].map((v, i) => [`t${i + 1}`, v]),
    );
    expect(
      recipientsOf(TOP_25.rule, scores, [dq("t1")]).map((r) => r.entrantId),
    ).toEqual(["t2", "t3"]);
  });

  it("a DQ'd entrant can still get a manual set-award", () => {
    expect(
      recipientsOf(TOP_25.rule, { t1: 40, t2: 30, t3: 20, t4: 10 }, [
        dq("t1"),
        setAward("t1", true),
      ]),
    ).toContainEqual({ entrantId: "t1", manual: true });
  });
});

describe("manual awards and set-award overrides", () => {
  it("a manual Award has no automatic recipients", () => {
    expect(
      recipients(award({ type: "manual" }), standings([1, 2]), []),
    ).toEqual([]);
  });

  it("set-award adds a recipient, marked manual", () => {
    expect(
      recipients(award({ type: "manual" }), standings([1, 2]), [
        setAward("t2", true),
      ]),
    ).toEqual([{ entrantId: "t2", manual: true }]);
  });

  it("set-award with awarded: false removes an automatic recipient", () => {
    expect(
      recipients(AXES, standings([1, 2, 3]), [setAward("t1", false)]).map(
        (r) => r.entrantId,
      ),
    ).toEqual(["t2"]);
  });

  it("the latest set-award for an award and entrant wins", () => {
    const manual = award({ type: "manual" });
    expect(
      recipients(manual, standings([1, 2]), [
        setAward("t1", true),
        setAward("t1", false),
      ]),
    ).toEqual([]);
    expect(
      recipients(manual, standings([1, 2]), [
        setAward("t1", false),
        setAward("t1", true),
      ]),
    ).toEqual([{ entrantId: "t1", manual: true }]);
  });

  it("ignores set-award actions for other Awards", () => {
    expect(
      recipients(award({ type: "manual" }), standings([1, 2]), [
        setAward("t1", true, "0196cfa2-4c00-7000-8000-000000000031"),
      ]),
    ).toEqual([]);
  });
});

describe("set-award place: a manual recipient of a named-places Award shows the name", () => {
  const withPlace = (entrantId: string, place: string): OfficialAction => ({
    type: "set-award",
    awardId: AWARD,
    entrantId,
    awarded: true,
    place,
  });

  it("gives a manually added recipient the place's name", () => {
    expect(
      recipients(AXES, standings([1, 2, 3]), [withPlace("t3", "Gold Axe")]),
    ).toEqual([
      { entrantId: "t1", place: "Gold Axe", manual: false },
      { entrantId: "t2", place: "Silver Hatchet", manual: false },
      { entrantId: "t3", place: "Gold Axe", manual: true },
    ]);
  });

  it("replaces an automatic recipient's place, marked manual", () => {
    expect(
      recipients(AXES, standings([1, 2]), [withPlace("t2", "Gold Axe")]),
    ).toEqual([
      { entrantId: "t1", place: "Gold Axe", manual: false },
      { entrantId: "t2", place: "Gold Axe", manual: true },
    ]);
  });

  it("the latest set-award wins, place included", () => {
    expect(
      recipients(AXES, standings([1]), [
        withPlace("t2", "Silver Hatchet"),
        withPlace("t2", "Gold Axe"),
      ]),
    ).toContainEqual({ entrantId: "t2", place: "Gold Axe", manual: true });
  });

  it("a bad action replaced by a good one scores fine, with no warning", () => {
    const result = awardRecipients(AXES, standings([1]), [
      withPlace("t2", "Bronze Saw"),
      withPlace("t2", "Gold Axe"),
    ]);
    expect(result.recipients).toContainEqual({
      entrantId: "t2",
      place: "Gold Axe",
      manual: true,
    });
    expect(result.warnings).toEqual([]);
  });

  it("a bad effective place is left out with a warning; the automatic result stays", () => {
    const bad = withPlace("t1", "Bronze Saw");
    expect(awardRecipients(AXES, standings([1, 2]), [bad])).toEqual({
      recipients: [
        { entrantId: "t1", place: "Gold Axe", manual: false },
        { entrantId: "t2", place: "Silver Hatchet", manual: false },
      ],
      warnings: [
        {
          action: bad,
          message: expect.stringMatching(
            /"Bronze Saw" isn't a place of Award the-award/,
          ),
        },
      ],
    });
  });

  it("a place on an Award that isn't named places is left out with a warning", () => {
    for (const rule of [
      { type: "top-percent", percent: 25 },
      { type: "manual" },
    ] as const) {
      const result = awardRecipients(award(rule), standings([1]), [
        withPlace("t9", "Gold Axe"),
      ]);
      expect(result.recipients.map((r) => r.entrantId)).not.toContain("t9");
      expect(result.warnings.map((w) => w.message)).toEqual([
        expect.stringMatching(/only a named-places Award takes a place/),
      ]);
    }
  });

  it("scoreEvent returns the warnings and still scores the Event", () => {
    const bad: OfficialAction = {
      type: "set-award",
      awardId: AWARD,
      entrantId: "t2",
      awarded: true,
      place: "Bronze Saw",
    };
    const results = scoreEvent(
      smallEvent({
        scores: [{ t1: 20, t2: 10 }],
        awards: [{ ...AXES, competitionId: COMPETITION }],
        actions: [bad],
      }),
    );
    expect(results.awards[0]?.recipients).toEqual([
      { entrantId: "t1", place: "Gold Axe", manual: false },
      { entrantId: "t2", place: "Silver Hatchet", manual: false },
    ]);
    expect(results.warnings).toEqual([
      { action: bad, message: expect.stringMatching(/Bronze Saw/) },
    ]);
  });
});

describe("Division scope isn't built yet", () => {
  it("rejects a Division-scoped Award with a clear not-yet error", () => {
    expect(() =>
      recipients(award({ type: "manual" }, "division"), standings([1]), []),
    ).toThrow(/Division-scoped awards aren't supported yet/);
  });
});

describe("scoreEvent: Top Dog on the real Circus 2026 Troop Challenge standings", () => {
  const circus = loadCircus2026AsRun();
  const troops = circus.competitionIdOf("troop-challenges");
  const topDog: Award = {
    id: AWARD,
    slug: "top-dog",
    label: "Top Dog",
    competitionId: troops,
    scope: "event",
    rule: { type: "top-percent", percent: 25 },
  };
  const results = scoreEvent({
    ...circus.input,
    event: { ...circus.input.event, awards: [topDog] },
  });
  const troopStandings =
    results.standings.find((s) => s.competitionId === troops)?.entrants ?? [];

  it("awards the top 25% of the 16 troops, rounded up, ties at the line included", () => {
    expect(troopStandings).toHaveLength(16);
    expect(results.awards).toEqual([
      {
        awardId: AWARD,
        recipients: withinCutoff(
          troopStandings.flatMap((s) => (s.disqualified ? [] : [s])),
          4,
        ).map((s) => ({
          entrantId: s.entrantId,
          manual: false,
        })),
      },
    ]);
  });
});
