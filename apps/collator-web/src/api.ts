import type {
  JudgeEvent,
  ScoreSubmission,
} from "@camporee-conductor/collator/types";

export interface Group {
  id: string;
  name: string;
}
export interface Team {
  id: string;
  groupId: string;
  name: string;
}
export interface Roster {
  groups: Group[];
  teams: Team[];
}

/** A failed call, with the Collator's message, or "can't reach the box" when there's no answer. */
export class ApiError extends Error {
  override name = "ApiError";
}

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
    throw new ApiError(body.error ?? `The box answered ${response.status}`);
  }
  return body as T;
}

const put = (path: string, body: unknown) =>
  call<{ status: "created" | "repeat" }>(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const api = {
  event: () => call<JudgeEvent>("/api/event"),
  roster: () => call<Roster>("/api/roster"),
  putGroup: (group: Group) =>
    put(`/api/groups/${group.id}`, { name: group.name }),
  putTeam: (team: Team) =>
    put(`/api/teams/${team.id}`, { groupId: team.groupId, name: team.name }),
  /** Resending the same id is always safe: the box answers "repeat" (ADR-0027 item 8). */
  putScore: ({ id, ...score }: ScoreSubmission) =>
    put(`/api/scores/${id}`, score),
};

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
