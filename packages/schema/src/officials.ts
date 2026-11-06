import { z } from "zod";
import { documentBase, NonEmptyText, Uuid7 } from "./common.ts";

/** One Official: signs in on the Collator with this email only (ADR-0027 item 5). */
export const OfficialSchema = z.strictObject({
  email: z.email(),
  name: NonEmptyText.optional(),
  /** The Director can add Officials on site. */
  role: z.enum(["director", "official"]),
});

/**
 * The Officials for one Event (issue #8). A separate document, not part of the Event: it travels only in
 * the event-day cartridge, never in a design cartridge or a Template (ADR-0027 item 5, ADR-0026).
 */
export const OfficialsSchema = z
  .strictObject({
    ...documentBase,
    kind: z.literal("officials"),
    eventId: Uuid7,
    officials: z.array(OfficialSchema),
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>();
    doc.officials.forEach((official, index) => {
      const email = official.email.toLowerCase();
      if (seen.has(email)) {
        ctx.addIssue({
          code: "custom",
          path: ["officials", index, "email"],
          message: `duplicate email ${email}`,
        });
      }
      seen.add(email);
    });
  });

export type Official = z.infer<typeof OfficialSchema>;
export type Officials = z.infer<typeof OfficialsSchema>;
