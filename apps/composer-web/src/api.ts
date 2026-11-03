import type { AppType } from "@camporee-conductor/composer-api/app";
import { hc, type ClientResponse } from "hono/client";

/** Headers that sign a request in; set by the active sign-in (see auth.tsx). */
let authHeaders: () => Promise<Record<string, string>> = () =>
  Promise.resolve({});

export function setAuthHeaders(
  headers: () => Promise<Record<string, string>>,
): void {
  authHeaders = headers;
}

/** The Composer API, typed from its routes (no code generation). */
export const client = hc<AppType>("/", {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(await authHeaders())) {
      headers.set(name, value);
    }
    return fetch(input, { ...init, headers });
  },
});

/** A failed API call, with the API's message. */
export class ApiError extends Error {
  override name = "ApiError";
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The response body of a successful call, or an ApiError. */
export async function data<T>(request: Promise<ClientResponse<T>>): Promise<T> {
  const response = await request;
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new ApiError(response.status, body.error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}
