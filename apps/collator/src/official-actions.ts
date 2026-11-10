import type { CheckedBundle } from "@camporee-conductor/cartridge";
import type { OfficialAction } from "@camporee-conductor/scoring";
import type { Db } from "./db/open.ts";
import type { Recorded } from "./roster-and-scores.ts";

/** One logged Official action, as stored (ADR-0019). */
export interface LoggedAction {
  seq: number;
  id: string;
  officialEmail: string;
  action: OfficialAction;
  clientCreatedAt: string;
  receivedAt: Date;
}

export interface ActionSubmission {
  id: string;
  officialEmail: string;
  action: OfficialAction;
  clientCreatedAt: string;
}

// Stubs until the green commit.
export function recordOfficialAction(
  db: Db,
  bundle: CheckedBundle,
  submission: ActionSubmission,
): Recorded {
  void [db, bundle, submission];
  throw new Error("not implemented");
}

export function loggedActions(db: Db): LoggedAction[] {
  void db;
  return [];
}
