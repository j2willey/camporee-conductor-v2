import type { Award, Competition, Event } from "@camporee-conductor/schema";
import { moveItem } from "./draft.ts";

/**
 * Edits to an Event's Competitions, Divisions and Awards (#6 PR 6), as pure functions on the Event. Each returns
 * a new Event for a whole-document save (ADR-0029).
 */

/** A random UUID v7 (RFC 9562): 48 bits of ms time, then random bits. Documents' ids are v7 (schema). */
export function newUuid7(now = new Date()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let time = now.getTime();
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** "Troop Challenges!" → "troop-challenges"; nothing usable → "item". */
export function slugify(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

/** `base`, or `base-2`, `base-3`…: the first not in `taken`. */
export function freeSlug(taken: Iterable<string>, base: string): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

/** A new Team Competition, last: registered entrants, no Divisions, default placement points. */
export function addCompetition(event: Event, label: string): Event {
  const competition: Competition = {
    id: newUuid7(),
    slug: freeSlug(
      event.competitions.map((c) => c.slug),
      slugify(label),
    ),
    label,
    level: "team",
    registration: "registered",
    divisions: [],
  };
  return { ...event, competitions: [...event.competitions, competition] };
}

export const moveCompetition = (
  event: Event,
  index: number,
  step: -1 | 1,
): Event => ({
  ...event,
  competitions: moveItem(event.competitions, index, step),
});

export const updateCompetition = (
  event: Event,
  index: number,
  change: (c: Competition) => Competition,
): Event => ({
  ...event,
  competitions: event.competitions.map((c, i) => (i === index ? change(c) : c)),
});

/**
 * Removes a Competition and its Awards. A Competition that still has Activities can't go: they'd have nowhere
 * to be, so the Activity list moves or removes them first.
 */
export function removeCompetition(
  event: Event,
  competitionId: string,
): { ok: true; event: Event } | { ok: false; problem: string } {
  const activities = event.activities.filter(
    (a) => a.competitionId === competitionId,
  ).length;
  if (activities > 0) {
    return {
      ok: false,
      problem: `It has ${activities} ${activities === 1 ? "Activity" : "Activities"}. Move or remove them on the Event page first.`,
    };
  }
  const awards = event.awards?.filter((a) => a.competitionId !== competitionId);
  return {
    ok: true,
    event: {
      ...event,
      competitions: event.competitions.filter((c) => c.id !== competitionId),
      ...(awards && { awards }),
    },
  };
}

/** A new Division, last in Competition `index`. */
export function addDivision(event: Event, index: number): Event {
  return updateCompetition(event, index, (c) => {
    const taken = c.divisions.map((d) => d.slug);
    let n = c.divisions.length + 1;
    while (taken.includes(`division-${n}`)) n++;
    return {
      ...c,
      divisions: [
        ...c.divisions,
        { id: newUuid7(), slug: `division-${n}`, label: `Division ${n}` },
      ],
    };
  });
}

/** A new Award for `competitionId`, last: the top three places, the whole Competition. */
export function addAward(event: Event, competitionId: string): Event {
  const awards = event.awards ?? [];
  const award: Award = {
    id: newUuid7(),
    slug: freeSlug(
      awards.map((a) => a.slug),
      "new-award",
    ),
    label: "New award",
    competitionId,
    scope: "event",
    rule: { type: "places", names: ["1st", "2nd", "3rd"] },
  };
  return { ...event, awards: [...awards, award] };
}

/** An Award rule switched to `type`, starting from a sensible value. The same type keeps the rule as it is. */
export function setRuleType(
  rule: Award["rule"],
  type: Award["rule"]["type"],
): Award["rule"] {
  if (rule.type === type) return rule;
  switch (type) {
    case "places":
      return { type, names: ["1st", "2nd", "3rd"] };
    case "top-percent":
      return { type, percent: 25 };
    case "manual":
      return { type };
  }
}
