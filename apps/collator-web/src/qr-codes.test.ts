import type { JudgeActivity } from "@camporee-conductor/collator/types";
import { describe, expect, it } from "vitest";
import {
  activityLink,
  activityFromLink,
  judgePageLink,
  qrModules,
  wifiJoinText,
} from "./qr-codes.ts";

// #41 PR 7: the printable QR codes (ADR-0023's primary flow): join the box's Wi-Fi, open the judge page,
// and one per Activity that opens it straight away.

describe("wifiJoinText", () => {
  it("is the Wi-Fi QR format phones read", () => {
    expect(
      wifiJoinText({
        ssid: "Coyote Creek",
        password: "s3cret",
        security: "WPA",
      }),
    ).toBe("WIFI:T:WPA;S:Coyote Creek;P:s3cret;;");
  });

  it("escapes the characters the format reserves", () => {
    expect(
      wifiJoinText({
        ssid: 'a;b,c:d"e',
        password: "back\\slash",
        security: "WPA",
      }),
    ).toBe('WIFI:T:WPA;S:a\\;b\\,c\\:d\\"e;P:back\\\\slash;;');
  });

  it("leaves out the password on an open network", () => {
    expect(
      wifiJoinText({ ssid: "Open", password: "ignored", security: "nopass" }),
    ).toBe("WIFI:T:nopass;S:Open;;");
  });
});

describe("links", () => {
  it("opens the judge page on the box", () => {
    expect(judgePageLink("https://judge.example.com")).toBe(
      "https://judge.example.com/",
    );
  });

  it("names one Activity, encoded", () => {
    expect(activityLink("https://judge.example.com", "clown car/2")).toBe(
      "https://judge.example.com/?activity=clown%20car%2F2",
    );
  });
});

describe("activityFromLink", () => {
  const activities = [
    { id: "clown-car", title: "Clown Car" },
    { id: "clown car/2", title: "Clown Car 2" },
  ] as unknown as JudgeActivity[];

  it("is nothing when the page wasn't opened from an Activity's code", () => {
    expect(activityFromLink("", activities)).toEqual({ kind: "none" });
    expect(activityFromLink("?other=1", activities)).toEqual({ kind: "none" });
  });

  it("finds the Activity the code names", () => {
    expect(activityFromLink("?activity=clown%20car%2F2", activities)).toEqual({
      kind: "found",
      activity: activities[1],
    });
  });

  it("says so when the event has no such Activity (an old printout)", () => {
    expect(activityFromLink("?activity=tightrope", activities)).toEqual({
      kind: "unknown",
      id: "tightrope",
    });
  });
});

describe("qrModules", () => {
  it("is a square grid of dark and light modules with a quiet zone", () => {
    const { size, dark } = qrModules("https://judge.example.com/");
    expect(size).toBeGreaterThanOrEqual(21 + 8);
    expect(dark).toHaveLength(size);
    for (const row of dark) expect(row).toHaveLength(size);
    // The quiet zone (4 modules) is light all round.
    expect(dark[0]?.some(Boolean)).toBe(false);
    expect(dark[3]?.some(Boolean)).toBe(false);
    // A finder pattern starts just inside it.
    expect(dark[4]?.[4]).toBe(true);
  });
});
