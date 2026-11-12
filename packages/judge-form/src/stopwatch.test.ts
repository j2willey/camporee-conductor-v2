import { stopwatchSeconds } from "@camporee-conductor/scoring";
import { describe, expect, it } from "vitest";
import {
  elapsedMs,
  formatElapsed,
  resetTimer,
  startTimer,
  stopTimer,
  STOPPED,
} from "./stopwatch.ts";

// #41 PR 4: a real timer for stopwatch fields. It runs on the clock, not on ticks, so a locked screen or a
// reload doesn't lose time; Stop gives the m:ss that packages/scoring reads.

describe("stopwatch", () => {
  it("counts from Start to Stop by the clock", () => {
    const running = startTimer(STOPPED, 1_000);
    expect(elapsedMs(running, 6_500)).toBe(5_500);
    const stopped = stopTimer(running, 66_000);
    expect(stopped).toEqual({ runningSince: null, elapsedMs: 65_000 });
    expect(elapsedMs(stopped, 999_999)).toBe(65_000);
  });

  it("carries on from where it stopped when started again", () => {
    const stopped = stopTimer(startTimer(STOPPED, 0), 10_000);
    const again = startTimer(stopped, 50_000);
    expect(elapsedMs(again, 55_000)).toBe(15_000);
  });

  it("ignores Start while running and Stop while stopped", () => {
    const running = startTimer(STOPPED, 1_000);
    expect(startTimer(running, 9_000)).toBe(running);
    expect(stopTimer(STOPPED, 9_000)).toBe(STOPPED);
  });

  it("resets to nothing", () => {
    expect(resetTimer()).toEqual(STOPPED);
  });

  it("writes whole seconds as m:ss, or h:mm:ss past an hour", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_999)).toBe("0:07");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(600_000)).toBe("10:00");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
  });

  it("writes what packages/scoring reads back as the same seconds", () => {
    for (const ms of [5_000, 65_000, 754_000, 3_725_000]) {
      expect(stopwatchSeconds(formatElapsed(ms))).toBe(ms / 1000);
    }
  });
});
