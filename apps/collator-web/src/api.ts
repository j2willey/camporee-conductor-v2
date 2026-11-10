import {
  OFFICIAL_EMAIL_HEADER,
  type ClosureSubmission,
  type Group,
  type JudgeEvent,
  type OfficialActivity,
  type OfficialEvent,
  type Roster,
  type ScoreSubmission,
  type SignedInOfficial,
  type Team,
} from "@camporee-conductor/collator/types";
import type { OutboxItem, SendResult } from "./outbox.ts";

/**
 * A failed call, with the Collator's message, or "can't reach the box" when there's no answer.
 * `refused`: the box answered and said no (4xx), so sending the same thing again can't help; anything
 * else (no answer, a 5xx) may have been saved or may succeed, so it's resent unchanged.
 */
export class ApiError extends Error {
  override name = "ApiError";
  readonly refused: boolean;
  /** The HTTP status the box answered, when it answered. */
  readonly status: number | undefined;
  constructor(message: string, refused = false, status?: number) {
    super(message);
    this.refused = refused;
    this.status = status;
  }
}

/** What to show the Judge for a failed call. */
export const errorMessage = (e: unknown) =>
  e instanceof ApiError ? e.message : String(e);

/** True when the box refused the request: resending it unchanged can't help. */
export const wasRefused = (e: unknown) => e instanceof ApiError && e.refused;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(
      "Can't reach the scoring box. Check the Wi-Fi and try again.",
    );
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new ApiError(
      body.error ?? `The box answered ${response.status}`,
      response.status >= 400 && response.status < 500,
      response.status,
    );
  }
  return body as T;
}

const put = (path: string, body: unknown) =>
  call<{ status: "created" | "repeat" }>(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** An Official call: the email goes with every one, and the box checks it each time (ADR-0027 item 5). */
const asOfficial = <T>(email: string, path: string) =>
  call<T>(`/api/official${path}`, {
    headers: { [OFFICIAL_EMAIL_HEADER]: email },
  });

export const officialApi = {
  me: (email: string) => asOfficial<SignedInOfficial>(email, "/me"),
  event: (email: string) => asOfficial<OfficialEvent>(email, "/event"),
  activity: (email: string, activityId: string) =>
    asOfficial<OfficialActivity>(
      email,
      `/activities/${encodeURIComponent(activityId)}`,
    ),
  /** Log an Official action (#42 PR 2b). Resending the same id is safe: the box answers "repeat". */
  act: (email: string, id: string, body: OfficialActionBody) =>
    call<{ status: "created" | "repeat" }>(
      `/api/official/actions/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [OFFICIAL_EMAIL_HEADER]: email,
        },
        body: JSON.stringify(body),
      },
    ),
};

/** What `PUT /api/official/actions/:id` takes so far: a DQ or reinstatement, and a field correction or its revert, and a choice of which entry counts, finalize and unfinalize, a manual rank and Official points. A number is sent as typed when it isn't one, so the box's message explains. */
export interface OfficialActionBody {
  action:
    | {
        type: "disqualify";
        activityId: string;
        entrantId: string;
        disqualified: boolean;
        notes?: string;
      }
    | {
        type: "set-field-value";
        activityId: string;
        entrantId: string;
        entryId: string;
        fieldId: string;
        value: number | string | boolean | null;
        notes?: string;
      }
    | {
        type: "revert-field-value";
        activityId: string;
        entrantId: string;
        entryId: string;
        fieldId: string;
        notes?: string;
      }
    | {
        type: "choose-entry";
        activityId: string;
        entrantId: string;
        entryId: string;
        newestEntryId: string;
        notes?: string;
      }
    | {
        type: "finalize";
        activityId: string;
        ranking: OfficialActivity["finalizeRanking"];
        notes?: string;
      }
    | { type: "unfinalize"; activityId: string; notes?: string }
    | {
        type: "set-final-rank";
        activityId: string;
        entrantId: string;
        rank: number | string;
        notes?: string;
      }
    | {
        type: "adjust-points";
        activityId: string;
        entrantId: string;
        points: number | string;
        notes?: string;
      };
  clientCreatedAt: string;
}

export const api = {
  event: () => call<JudgeEvent>("/api/event"),
  roster: () => call<Roster>("/api/roster"),
  putGroup: (group: Group) =>
    put(`/api/groups/${group.id}`, { name: group.name }),
  putTeam: (team: Team) =>
    put(`/api/teams/${team.id}`, { groupId: team.groupId, name: team.name }),
  /** Close an Activity (#41 PR 6): the box answers which of the scores it has. */
  putClosure: (id: string, closure: Omit<ClosureSubmission, "id">) =>
    call<{ status: "created" | "repeat"; have: number; missing: string[] }>(
      `/api/closures/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(closure),
      },
    ),
  /** Resending the same id is always safe: the box answers "repeat" (ADR-0027 item 8). */
  putScore: ({ id, ...score }: ScoreSubmission) =>
    put(`/api/scores/${id}`, score),
};

/** One send from the outbox (#41 PR 2): what the box answered, or that it couldn't be reached. */
export async function sendQueued(item: OutboxItem): Promise<SendResult> {
  try {
    const { status } = await put(item.path, item.body);
    return { ok: true, repeat: status === "repeat" };
  } catch (e) {
    return { ok: false, refused: wasRefused(e), message: errorMessage(e) };
  }
}

/** A new id, made on the phone (ADR-0027 item 8). */
export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID needs HTTPS or localhost; fall back on plain HTTP in development.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
