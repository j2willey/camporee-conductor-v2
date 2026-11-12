import { describe, expect, it } from "vitest";
import { fakeProvider } from "./fake.ts";
import { AiError, type AiProvider } from "./provider.ts";
import { testKey } from "./test-key.ts";

/** "Test the key" (ADR-0030 item 7): one tiny request, then the answer or the error. */

describe("testKey", () => {
  it("says which model answered, and what it said", async () => {
    const ai = fakeProvider(() => "OK");
    expect(await testKey(ai)).toEqual({
      ok: true,
      model: "fake",
      reply: "OK",
    });
    expect(ai.requests).toHaveLength(1);
  });

  it("gives the provider's error", async () => {
    const failing: AiProvider = {
      model: "claude-sonnet-5-5",
      complete: () =>
        Promise.reject(
          new AiError("The AI provider failed: invalid x-api-key"),
        ),
    };
    expect(await testKey(failing)).toEqual({
      ok: false,
      model: "claude-sonnet-5-5",
      error: "The AI provider failed: invalid x-api-key",
    });
  });
});
