import type { AiProvider, AiRequest } from "./provider.ts";

/** A provider for tests and local development (ADR-0030 item 7): answers from `reply`, and keeps every request. */
export function fakeProvider(
  reply: (request: AiRequest) => string,
): AiProvider & { requests: AiRequest[] } {
  const requests: AiRequest[] = [];
  return {
    model: "fake",
    requests,
    complete(request) {
      requests.push(request);
      return Promise.resolve(reply(request));
    },
  };
}
