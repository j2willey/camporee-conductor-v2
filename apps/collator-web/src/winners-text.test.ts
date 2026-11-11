import { describe, expect, it } from "vitest";
import {
  announcerExhibitionRow,
  announcerRow,
  exhibitionRowText,
  provisionalBanner,
  stickerExhibitionLine,
  stickerRows,
  stickerWinnerLine,
  winnerName,
  winnerPlace,
  winnerRow,
} from "./winners-text.ts";

describe("winners text", () => {
  it("names a Team with its Group, a Group alone, and an unknown id", () => {
    expect(winnerName({ group: "Troop 101", team: "Owls" })).toBe(
      "Owls (Troop 101)",
    );
    expect(winnerName({ group: "Troop 101", team: null })).toBe("Troop 101");
    expect(winnerName({ group: null, team: null })).toBe("(unknown)");
  });

  it("says a place name, else an ordinal, else the Award's title", () => {
    expect(winnerPlace({ rank: 1, place: "Gold Axe" }, "Axes")).toBe(
      "Gold Axe",
    );
    expect(winnerPlace({ rank: 2 }, "Clown Car")).toBe("2nd");
    expect(winnerPlace({}, "Top Dog")).toBe("Top Dog");
  });

  it("marks an Official's own choice", () => {
    expect(
      winnerRow(
        { title: "Top Dog" },
        {
          entrantId: "g",
          entrant: { group: "Troop 7", team: null },
          manual: true,
        },
      ),
    ).toEqual({ place: "Top Dog", name: "Troop 7", official: true });
  });

  it("says Provisional until every Activity is final", () => {
    expect(
      provisionalBanner({
        provisional: true,
        finalizedCount: 3,
        rankedCount: 20,
        exhibitionCount: 0,
        exhibitionFinalCount: 0,
      }),
    ).toBe("Provisional: 3 of 20 Activities final. Awards may change.");
    expect(
      provisionalBanner({
        provisional: false,
        finalizedCount: 20,
        rankedCount: 20,
        exhibitionCount: 0,
        exhibitionFinalCount: 0,
      }),
    ).toBe("All Activities final.");
  });

  it("counts Exhibitions too, when the Event has any", () => {
    const base = { rankedCount: 20, exhibitionCount: 2 };
    expect(
      provisionalBanner({
        ...base,
        provisional: true,
        finalizedCount: 3,
        exhibitionFinalCount: 1,
      }),
    ).toBe(
      "Provisional: 3 of 20 Activities and 1 of 2 Exhibitions final. Awards may change.",
    );
    expect(
      provisionalBanner({
        ...base,
        provisional: false,
        finalizedCount: 20,
        exhibitionFinalCount: 2,
      }),
    ).toBe("All Activities and Exhibitions final.");
  });

  it("says an Exhibition row as typed", () => {
    expect(
      exhibitionRowText({
        participantName: "Amy",
        group: "Troop 101",
        team: "Owls",
        place: "1st",
        notes: "fast",
      }),
    ).toEqual({
      place: "1st",
      name: "Amy",
      belongs: "Troop 101 / Owls",
      notes: "fast",
    });
  });
});

describe("sticker winner line (v1's shape, with names)", () => {
  const team = { group: "Troop 101", team: "Flaming Arrows" };
  const group = { group: "Troop 101", team: null };

  it("an Activity place reads '1st Place - Group Team'", () => {
    expect(
      stickerWinnerLine(
        { title: "Clown Car" },
        { rank: 1, entrantId: "t", entrant: team, manual: false },
      ),
    ).toBe("1st Place - Troop 101 Flaming Arrows");
    expect(
      stickerWinnerLine(
        { title: "Clown Car" },
        { rank: 12, entrantId: "t", entrant: team, manual: false },
      ),
    ).toBe("12th Place - Troop 101 Flaming Arrows");
  });

  it("a Team with no Group is just the Team; a Group-level entrant is the Group", () => {
    expect(
      stickerWinnerLine(
        { title: "A" },
        {
          rank: 2,
          entrantId: "t",
          entrant: { group: null, team: "Owls" },
          manual: false,
        },
      ),
    ).toBe("2nd Place - Owls");
    expect(
      stickerWinnerLine(
        { title: "A" },
        { rank: 3, entrantId: "g", entrant: group, manual: false },
      ),
    ).toBe("3rd Place - Troop 101");
  });

  it("an unknown entrant says (unknown)", () => {
    expect(
      stickerWinnerLine(
        { title: "A" },
        {
          rank: 1,
          entrantId: "x",
          entrant: { group: null, team: null },
          manual: false,
        },
      ),
    ).toBe("1st Place - (unknown)");
  });

  it("a named place reads '<place> - who'", () => {
    expect(
      stickerWinnerLine(
        { title: "Axes" },
        {
          rank: 1,
          place: "Gold Axe",
          entrantId: "g",
          entrant: group,
          manual: false,
        },
      ),
    ).toBe("Gold Axe - Troop 101");
  });

  it("a place name that is itself an ordinal (Overall) reads '1st Place - who'", () => {
    for (const [place, said] of [
      ["1st", "1st Place"],
      ["2nd", "2nd Place"],
      ["3rd", "3rd Place"],
      ["4th", "4th Place"],
      ["11th", "11th Place"],
    ] as const) {
      expect(
        stickerWinnerLine(
          { title: "Overall" },
          { place, entrantId: "g", entrant: group, manual: false },
        ),
      ).toBe(`${said} - Troop 101`);
    }
  });

  it("an Award with no place or rank (Top Dog) reads '<Award title> - who'", () => {
    expect(
      stickerWinnerLine(
        { title: "Top Dog" },
        { entrantId: "g", entrant: group, manual: false },
      ),
    ).toBe("Top Dog - Troop 101");
  });
});

describe("sticker Exhibition line", () => {
  const row = (over = {}) => ({
    participantName: "Jane Doe",
    group: "",
    team: "",
    place: "1st",
    notes: "",
    ...over,
  });

  it("reads '<place> - <name>', then the Group and Team when given", () => {
    expect(stickerExhibitionLine(row())).toBe("1st - Jane Doe");
    expect(stickerExhibitionLine(row({ group: "Troop 101" }))).toBe(
      "1st - Jane Doe, Troop 101",
    );
    expect(
      stickerExhibitionLine(row({ group: "Troop 101", team: "Owls" })),
    ).toBe("1st - Jane Doe, Troop 101 Owls");
  });

  it("keeps the place as typed, and leaves it out when empty", () => {
    expect(stickerExhibitionLine(row({ place: "Best Dressed" }))).toBe(
      "Best Dressed - Jane Doe",
    );
    expect(stickerExhibitionLine(row({ place: "" }))).toBe("Jane Doe");
  });
});

describe("sticker rows", () => {
  it("chunks into rows of 3 in the given order, the last row short", () => {
    expect(stickerRows([1, 2, 3, 4, 5, 6, 7])).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7],
    ]);
    expect(stickerRows([])).toEqual([]);
    expect(stickerRows(["b", "a"])).toEqual([["b", "a"]]);
  });
});

describe("announcer rows", () => {
  const team = { group: "Troop 101", team: "Owls" };

  it("an Activity line: the place, the name and 'N pts'", () => {
    expect(
      announcerRow(
        { title: "Clown Car" },
        { rank: 1, entrantId: "t1", entrant: team, manual: false, total: 14 },
      ),
    ).toEqual({ place: "1st", name: "Owls (Troop 101)", score: "14 pts" });
  });

  it("a tie says '1st' twice", () => {
    const line = (id: string) => ({
      rank: 1,
      entrantId: id,
      entrant: team,
      manual: false,
      total: 9,
    });
    const g = { title: "Clown Car" };
    expect(announcerRow(g, line("a")).place).toBe("1st");
    expect(announcerRow(g, line("b")).place).toBe("1st");
  });

  it("a named place is said as named", () => {
    expect(
      announcerRow(
        { title: "Overall" },
        {
          rank: 2,
          place: "Silver Axe",
          entrantId: "t1",
          entrant: team,
          manual: false,
          total: 18,
        },
      ).place,
    ).toBe("Silver Axe");
  });

  it("a top-percent Award (Top Dog) has no place, and 0 pts is still said", () => {
    expect(
      announcerRow(
        { title: "Top Dog" },
        {
          entrantId: "g1",
          entrant: { group: "Troop 101", team: null },
          manual: false,
          total: 0,
        },
      ),
    ).toEqual({ place: "", name: "Troop 101", score: "0 pts" });
  });

  it("no total means no score", () => {
    expect(
      announcerRow(
        { title: "Overall" },
        { rank: 1, entrantId: "x", entrant: team, manual: true },
      ).score,
    ).toBe("");
  });

  it("an Exhibition row: place as typed, name, 'Group / Team', notes", () => {
    expect(
      announcerExhibitionRow({
        participantName: "Jane Doe",
        group: "Troop 101",
        team: "Owls",
        place: "1st",
        notes: "Bullseye",
      }),
    ).toEqual({
      place: "1st",
      name: "Jane Doe",
      belongs: "Troop 101 / Owls",
      notes: "Bullseye",
    });
  });
});
