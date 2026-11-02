import type { Award } from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import { loadCircus2026AsRun } from "../scripts/circus-2026-as-run.ts";
import {
  awardRecipients,
  scoreEvent,
  withinCutoff,
  type OfficialAction,
  type Standing,
} from "./index.ts";

const COMPETITION = "0196cfa2-4c00-7000-8000-000000000020";
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

/** Standings with these ranks, entrants t1, t2…; `dq` lists DQ'd entrants by position (1-based). */
function standings(ranks: number[], dq: number[] = []): Standing[] {
  return ranks.map((rank, i) => ({
    entrantId: `t${i + 1}`,
    total: 1000 - rank,
    rank,
    ...(dq.includes(i + 1) ? { disqualified: true } : {}),
  }));
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
    expect(awardRecipients(AXES, standings([1, 1, 2, 3]), [])).toEqual([
      { entrantId: "t1", place: "Gold Axe", manual: false },
      { entrantId: "t2", place: "Gold Axe", manual: false },
      { entrantId: "t3", place: "Silver Hatchet", manual: false },
    ]);
  });

  it("strict 1, 1, 3: two Gold Axes and no Silver Hatchet", () => {
    expect(awardRecipients(AXES, standings([1, 1, 3]), [])).toEqual([
      { entrantId: "t1", place: "Gold Axe", manual: false },
      { entrantId: "t2", place: "Gold Axe", manual: false },
    ]);
  });
});

describe("top-percent is a counted cutoff, ties at the line included", () => {
  it("rounds the count up: 25% of 10 entrants is 3", () => {
    const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(
      awardRecipients(TOP_25, standings(ranks), []).map((r) => r.entrantId),
    ).toEqual(["t1", "t2", "t3"]);
  });

  it("uses withinCutoff, so a tie at the line takes everyone tied", () => {
    const ranked = standings([
      1, 2, 3, 4, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    const recipients = awardRecipients(TOP_25, ranked, []);
    expect(recipients.map((r) => r.entrantId)).toEqual(
      withinCutoff(ranked, 4).map((s) => s.entrantId),
    );
    expect(recipients).toHaveLength(5);
  });
});

describe("DQ'd entrants never receive an automatic award", () => {
  it("top-percent counts only entrants who aren't DQ'd, and skips the DQ'd", () => {
    // 9 entrants, 1 DQ'd → 25% of 8 = 2.
    const ranked = standings([1, 2, 3, 4, 5, 6, 7, 8, 9], [1]);
    expect(awardRecipients(TOP_25, ranked, []).map((r) => r.entrantId)).toEqual(
      ["t2", "t3"],
    );
  });

  it("named places skip a DQ'd entrant", () => {
    expect(
      awardRecipients(AXES, standings([1, 1, 2], [1]), []).map(
        (r) => r.entrantId,
      ),
    ).toEqual(["t2", "t3"]);
  });

  it("a DQ'd entrant can still get a manual set-award", () => {
    expect(
      awardRecipients(TOP_25, standings([1, 2, 3, 4], [1]), [
        setAward("t1", true),
      ]),
    ).toContainEqual({ entrantId: "t1", manual: true });
  });
});

describe("manual awards and set-award overrides", () => {
  it("a manual Award has no automatic recipients", () => {
    expect(
      awardRecipients(award({ type: "manual" }), standings([1, 2]), []),
    ).toEqual([]);
  });

  it("set-award adds a recipient, marked manual", () => {
    expect(
      awardRecipients(award({ type: "manual" }), standings([1, 2]), [
        setAward("t2", true),
      ]),
    ).toEqual([{ entrantId: "t2", manual: true }]);
  });

  it("set-award with awarded: false removes an automatic recipient", () => {
    expect(
      awardRecipients(AXES, standings([1, 2, 3]), [setAward("t1", false)]).map(
        (r) => r.entrantId,
      ),
    ).toEqual(["t2"]);
  });

  it("the latest set-award for an award and entrant wins", () => {
    const manual = award({ type: "manual" });
    expect(
      awardRecipients(manual, standings([1, 2]), [
        setAward("t1", true),
        setAward("t1", false),
      ]),
    ).toEqual([]);
    expect(
      awardRecipients(manual, standings([1, 2]), [
        setAward("t1", false),
        setAward("t1", true),
      ]),
    ).toEqual([{ entrantId: "t1", manual: true }]);
  });

  it("ignores set-award actions for other Awards", () => {
    expect(
      awardRecipients(award({ type: "manual" }), standings([1, 2]), [
        setAward("t1", true, "0196cfa2-4c00-7000-8000-000000000031"),
      ]),
    ).toEqual([]);
  });
});

describe("Division scope isn't built yet", () => {
  it("rejects a Division-scoped Award with a clear not-yet error", () => {
    expect(() =>
      awardRecipients(
        award({ type: "manual" }, "division"),
        standings([1]),
        [],
      ),
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
        recipients: withinCutoff(troopStandings, 4).map((s) => ({
          entrantId: s.entrantId,
          manual: false,
        })),
      },
    ]);
  });
});
