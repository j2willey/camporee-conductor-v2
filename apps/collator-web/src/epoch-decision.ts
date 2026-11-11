// What a phone does about a new box epoch (#66). Pure: the answer of `GET /api/epochs?since=` in, an action out.

export interface EpochInfo {
  id: string;
  reason: "created" | "restore" | "reset";
}

/** What `GET /api/epochs?since=<known>` answers. */
export interface EpochAnswer {
  current: EpochInfo;
  /** The epochs after the one the phone knew, oldest first; null when the box doesn't know that one. */
  since: EpochInfo[] | null;
  unknown: boolean;
}

export type EpochAction = "none" | "reset" | "restore";

/**
 * "reset" when any epoch since was a reset (nothing comes back, even if a restore followed: the Officials
 * wanted it empty). "restore" when there were only restores, or the box doesn't know the epoch the phone knew.
 */
export function decideEpoch(answer: EpochAnswer): EpochAction {
  if (answer.unknown || answer.since === null) return "restore";
  if (answer.since.length === 0) return "none";
  return answer.since.some((e) => e.reason === "reset") ? "reset" : "restore";
}
