import type { CheckedBundle } from "@camporee-conductor/cartridge";
import { AwardLabelSchema } from "@camporee-conductor/schema";
import { desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "./db/open.ts";
import { awardLabelSaves } from "./db/schema.ts";
import { officialByEmail } from "./officials.ts";
import { conflict, invalid, type Recorded } from "./roster-and-scores.ts";

// Award sticker label settings (ADR-0027, #43 PR 3): the Event's `presentation.awardLabel` until an Official saves
// another on the box; saves are appended to a log and the newest wins. The Event document is never edited.

export type AwardLabel = z.infer<typeof AwardLabelSchema>;

/** v1's list of system fonts, so nothing is fetched. */
export const LABEL_FONTS = [
  "Arial, sans-serif",
  "'Times New Roman', serif",
  "Georgia, serif",
  "'Courier New', monospace",
  "'Brush Script MT', cursive",
  "'Comic Sans MS', cursive",
  "Impact, sans-serif",
];

const STYLE_NAMES = ["line1", "line2", "activityName", "winner"] as const;

export interface AwardLabelView {
  label: AwardLabel;
  source: "event" | "box";
  savedBy?: string;
  savedAt?: string;
}

const defaultLabel = (title: string): AwardLabel => {
  const style = { font: "Arial, sans-serif", size: "10pt", bold: false };
  return {
    line1: title,
    line2: "",
    syncFonts: true,
    styles: {
      line1: { ...style },
      line2: { ...style },
      activityName: { ...style },
      winner: { ...style },
    },
  };
};

const latestSave = (db: Db) =>
  db
    .select()
    .from(awardLabelSaves)
    .orderBy(desc(awardLabelSaves.seq))
    .limit(1)
    .get();

export function awardLabelView(db: Db, bundle: CheckedBundle): AwardLabelView {
  const latest = latestSave(db);
  if (latest) {
    return {
      label: JSON.parse(latest.label) as AwardLabel,
      source: "box",
      savedBy:
        officialByEmail(db, bundle, latest.officialEmail)?.name ??
        latest.officialEmail,
      savedAt: latest.receivedAt.toISOString(),
    };
  }
  return {
    label:
      bundle.event.presentation.awardLabel ?? defaultLabel(bundle.event.title),
    source: "event",
  };
}

/** A problem in plain words, or undefined when the label is fine. */
function problemWith(label: AwardLabel): string | undefined {
  for (const name of STYLE_NAMES) {
    const { font, size } = label.styles[name];
    if (!LABEL_FONTS.includes(font))
      return `${name}: "${font}" isn't a font on the list`;
    const match = /^(\d+)pt$/.exec(size);
    const points = match ? Number(match[1]) : NaN;
    if (!(points >= 6 && points <= 36)) {
      return `${name}: the size must be 6pt to 36pt, like "10pt"`;
    }
  }
  return undefined;
}

export interface AwardLabelSubmission {
  id: string;
  /** `normalEmail()` of the Official. */
  officialEmail: string;
  label: unknown;
  clientCreatedAt: string;
}

const contentOf = (email: string, label: AwardLabel, clientCreatedAt: string) =>
  JSON.stringify([email, label, clientCreatedAt]);

/**
 * Logs a save of the whole label. A resend of the same id and content is a repeat; the same id with other content is
 * a conflict.
 */
export function recordAwardLabel(
  db: Db,
  submission: AwardLabelSubmission,
): Recorded {
  const { id, officialEmail, clientCreatedAt } = submission;
  const parsed = AwardLabelSchema.safeParse(submission.label);
  const existing = db
    .select()
    .from(awardLabelSaves)
    .where(eq(awardLabelSaves.id, id))
    .get();
  if (existing) {
    const same =
      parsed.success &&
      contentOf(
        existing.officialEmail,
        JSON.parse(existing.label) as AwardLabel,
        existing.clientCreatedAt,
      ) === contentOf(officialEmail, parsed.data, clientCreatedAt);
    return same
      ? { ok: true, status: "repeat" }
      : conflict("Award label save", id);
  }
  if (!parsed.success) {
    return invalid("The label isn't in the right shape for a sticker label");
  }
  const problem = problemWith(parsed.data);
  if (problem !== undefined) return invalid(problem);
  db.insert(awardLabelSaves)
    .values({
      id,
      officialEmail,
      label: JSON.stringify(parsed.data),
      clientCreatedAt,
      receivedAt: new Date(),
    })
    .run();
  return { ok: true, status: "created" };
}
