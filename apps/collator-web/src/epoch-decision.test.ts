import { describe, expect, it } from "vitest";
import {
  decideEpoch,
  type EpochAnswer,
  type EpochInfo,
} from "./epoch-decision.ts";

const e = (id: string, reason: EpochInfo["reason"]): EpochInfo => ({
  id,
  reason,
});
const answer = (since: EpochInfo[]): EpochAnswer => ({
  current: since.at(-1) ?? e("now", "created"),
  since,
  unknown: false,
});

describe("decideEpoch", () => {
  it("does nothing when the epoch hasn't changed", () => {
    expect(decideEpoch(answer([]))).toBe("none");
  });
  it("restore: resend what the archive holds", () => {
    expect(decideEpoch(answer([e("b", "restore")]))).toBe("restore");
  });
  it("reset: drop everything", () => {
    expect(decideEpoch(answer([e("b", "reset")]))).toBe("reset");
  });
  it("restore then reset: a reset happened, so drop", () => {
    expect(decideEpoch(answer([e("b", "restore"), e("c", "reset")]))).toBe(
      "reset",
    );
  });
  it("reset then restore: a reset happened, so drop", () => {
    expect(decideEpoch(answer([e("b", "reset"), e("c", "restore")]))).toBe(
      "reset",
    );
  });
  it("two restores: resend", () => {
    expect(decideEpoch(answer([e("b", "restore"), e("c", "restore")]))).toBe(
      "restore",
    );
  });
  it("an epoch the box doesn't know: resend, the same as a restore", () => {
    expect(
      decideEpoch({
        current: e("z", "restore"),
        since: null,
        unknown: true,
      }),
    ).toBe("restore");
  });
});
