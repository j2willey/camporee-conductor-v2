/**
 * Circus 2026 as run, as packages/scoring input: the as-run design documents (packages/schema
 * fixtures/circus-2026-as-run/) plus the anonymized Collator results (fixtures/circus-2026-results/).
 * For the parity test against v1-golden.json (issue #3).
 *
 * v1 kept Official overrides in the score payload (`manual_rank`, `manual_points`, and `off_score`, the
 * Official Score it added to the total). v2 logs them as Official actions, so they are moved out of the
 * entry values here.
 */
import { readdirSync, readFileSync } from "node:fs";
import {
  ActivitySchema,
  CommonFieldSetSchema,
  EventSchema,
} from "@camporee-conductor/schema";
import type {
  FieldValue,
  OfficialAction,
  ScoreEntry,
  ScoringInput,
} from "../src/index.ts";
import type { V1Entity } from "./v1/types.d.ts";

const AS_RUN = new URL(
  "../../schema/fixtures/circus-2026-as-run/",
  import.meta.url,
);
const RESULTS = new URL("../fixtures/circus-2026-results/", import.meta.url);

/** v1 entity type → the Competition (by its v1 id) its entities enter. */
const COMPETITION_OF_ENTITY_TYPE: Record<string, string> = {
  patrol: "patrol-games",
  troop: "troop-challenges",
};

const OVERRIDE_KEYS = new Set(["manual_rank", "manual_points", "off_score"]);

const readJson = (url: URL): unknown =>
  JSON.parse(readFileSync(url, "utf8")) as unknown;

/** A v1 Official override from the score payload as a number, or undefined if not set. */
function overrideOf(
  payload: Readonly<Record<string, FieldValue>>,
  key: string,
  where: string,
): number | undefined {
  const value = payload[key];
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (typeof value === "boolean" || !Number.isFinite(n)) {
    throw new Error(`${where} ${key} is not a number: ${String(value)}`);
  }
  return n;
}

export interface Circus2026AsRun {
  input: ScoringInput;
  /** v1 game id → as-run Activity id. */
  activityIdOf: (v1GameId: string) => string;
  /** v1 competition id ("patrol-games") → as-run Competition id. */
  competitionIdOf: (v1CompetitionId: string) => string;
}

export function loadCircus2026AsRun(): Circus2026AsRun {
  const event = EventSchema.parse(readJson(new URL("event.json", AS_RUN)));
  const commonFieldSet = CommonFieldSetSchema.parse(
    readJson(new URL("common-fields.json", AS_RUN)),
  );
  const activities = readdirSync(new URL("activities/", AS_RUN))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) =>
      ActivitySchema.parse(readJson(new URL(`activities/${f}`, AS_RUN))),
    );

  const activityIds = new Map(
    activities.map((a) => [a.legacy?.v1Id ?? a.slug, a.id]),
  );
  const competitionIds = new Map(
    event.competitions.map((c) => [c.legacy?.v1Id ?? c.slug, c.id]),
  );
  const lookup =
    (ids: Map<string, string>, what: string) =>
    (v1Id: string): string => {
      const id = ids.get(v1Id);
      if (!id) throw new Error(`no as-run ${what} for v1 id ${v1Id}`);
      return id;
    };
  const activityIdOf = lookup(activityIds, "Activity");
  const competitionIdOf = lookup(competitionIds, "Competition");

  const entities = readJson(new URL("entities.json", RESULTS)) as V1Entity[];
  const entrants = entities.map((e) => {
    const competition = COMPETITION_OF_ENTITY_TYPE[e.type];
    if (!competition) throw new Error(`unknown entity type ${e.type}`);
    return { id: e.id, competitionId: competitionIdOf(competition) };
  });

  const scores = readJson(new URL("scores.json", RESULTS)) as {
    game_id: string;
    entity_id: string;
    score_payload: Record<string, FieldValue>;
  }[];
  const entries: ScoreEntry[] = [];
  const actions: OfficialAction[] = [];
  for (const s of scores) {
    const activityId = activityIdOf(s.game_id);
    const entrantId = s.entity_id;
    const payload = s.score_payload;
    entries.push({
      activityId,
      entrantId,
      // Some v1 field ids end in a space; the transcode trimmed them, so trim the payload keys too.
      values: Object.fromEntries(
        Object.entries(payload)
          .filter(([k]) => !OVERRIDE_KEYS.has(k))
          .map(([k, v]) => [k.trim(), v]),
      ),
    });
    const where = `${s.game_id}/${entrantId}`;
    const rank = overrideOf(payload, "manual_rank", where);
    const points = overrideOf(payload, "manual_points", where);
    const adjustment = overrideOf(payload, "off_score", where);
    const target = { activityId, entrantId };
    if (rank !== undefined)
      actions.push({ type: "set-final-rank", ...target, rank });
    if (points !== undefined)
      actions.push({ type: "set-placement-points", ...target, points });
    if (adjustment !== undefined)
      actions.push({ type: "adjust-points", ...target, points: adjustment });
  }

  return {
    input: {
      event,
      activities,
      commonFieldSets: [commonFieldSet],
      entrants,
      entries,
      actions,
    },
    activityIdOf,
    competitionIdOf,
  };
}
