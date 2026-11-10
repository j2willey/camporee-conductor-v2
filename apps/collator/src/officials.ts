import type { CheckedBundle } from "@camporee-conductor/cartridge";
import type { Official } from "@camporee-conductor/schema";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/open.ts";
import { addedOfficials } from "./db/schema.ts";
import { loadedEvent } from "./load-event.ts";

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
  db: Db,
  bundle: CheckedBundle,
): EffectiveOfficial[] {
  const byEmail = new Map<string, EffectiveOfficial>();
  for (const o of bundle.officials?.officials ?? []) {
    byEmail.set(normalEmail(o.email), { ...o, source: "cartridge" });
  }
  const added = db
    .select()
    .from(addedOfficials)
    .where(eq(addedOfficials.eventId, bundle.event.id))
    .orderBy(asc(addedOfficials.seq))
    .all();
  for (const row of added) {
    byEmail.set(row.email, {
      email: row.email,
      ...(row.name !== null && { name: row.name }),
      role: row.role,
      source: "box",
      addedAt: row.addedAt,
    });
  }
  return [...byEmail.values()];
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

const EmailAddress = z.string().trim().toLowerCase().pipe(z.email());

/**
 * Adds an Official for the loaded Event, or updates the name or role of one already on the list (the newest
 * addition for an email wins). The cartridge's document is never touched.
 */
export function addOfficial(
  db: Db,
  input: { email: string; name?: string; role?: Official["role"] },
): AddOfficialResult {
  const event = loadedEvent(db);
  if (!event) return { ok: false, error: "no Event is loaded on this box yet" };
  const email = EmailAddress.safeParse(input.email);
  if (!email.success) {
    return { ok: false, error: `"${input.email}" isn't a valid email address` };
  }
  const current = officialByEmail(db, event.bundle, email.data);
  const name = input.name?.trim() || current?.name;
  const role = input.role ?? current?.role ?? "official";
  const addedAt = new Date();
  db.insert(addedOfficials)
    .values({
      eventId: event.bundle.event.id,
      email: email.data,
      name: name ?? null,
      role,
      addedAt,
    })
    .run();
  return {
    ok: true,
    status: current ? "updated" : "added",
    official: {
      email: email.data,
      ...(name !== undefined && { name }),
      role,
      source: "box",
      addedAt,
    },
  };
}
