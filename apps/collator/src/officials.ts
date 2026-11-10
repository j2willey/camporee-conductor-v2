import type { CheckedBundle } from "@camporee-conductor/cartridge";
import type { Official } from "@camporee-conductor/schema";
import type { Db } from "./db/open.ts";

// The box's Officials (#42 PR 5, ADR-0027 item 5): the cartridge's list with the ones added on the console laid over it.

/** An email as Officials are matched: trimmed, any case. */
export const normalEmail = (email: string) => email.trim().toLowerCase();

export interface EffectiveOfficial extends Official {
  source: "cartridge" | "box";
  /** When the newest console addition for this email was made; box additions only. */
  addedAt?: Date;
}

export type AddOfficialResult =
  | { ok: true; status: "added" | "updated"; official: EffectiveOfficial }
  | { ok: false; error: string };

/** The effective list: the cartridge's Officials with this Event's console additions laid over them. */
export function officialsOf(
  _db: Db,
  bundle: CheckedBundle,
): EffectiveOfficial[] {
  return (bundle.officials?.officials ?? []).map((o) => ({
    ...o,
    source: "cartridge" as const,
  }));
}

/** The Official on the effective list with this email, or undefined. */
export function officialByEmail(
  db: Db,
  bundle: CheckedBundle,
  email: string,
): EffectiveOfficial | undefined {
  const wanted = normalEmail(email);
  return officialsOf(db, bundle).find((o) => normalEmail(o.email) === wanted);
}

/** Adds an Official for the loaded Event, or updates the name or role of one already on the list. */
export function addOfficial(
  _db: Db,
  _input: { email: string; name?: string; role?: Official["role"] },
): AddOfficialResult {
  void _db;
  void _input;
  throw new Error("not implemented");
}
