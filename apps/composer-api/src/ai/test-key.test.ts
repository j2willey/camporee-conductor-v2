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

describe("cannedProvider (AI_ADAPTER=fake, development and test only)", () => {
  it("answers each brainstorm in its schema", async () => {
    const { cannedProvider } = await import("./fake.ts");
    const { suggestThemes, writeIntroductions } =
      await import("./brainstorm.ts");
    const ai = cannedProvider();
    expect((await suggestThemes(ai, "Event: X")).ideas.length).toBeGreaterThan(
      0,
    );
    expect(await writeIntroductions(ai, "Event: X")).toMatchObject({
      action: expect.any(String),
      lore: expect.any(String),
      skill: expect.any(String),
    });
    expect(await testKey(ai)).toMatchObject({ ok: true, model: "fake" });
    const { readEventBundle } = await import("../import/read-event-bundle.ts");
    const { CIRCUS_2026 } = await import("../test-support.ts");
    const { themeActivity } = await import("./theme-activity.ts");
    const activity = readEventBundle(CIRCUS_2026)
      .activities[0] as import("@camporee-conductor/schema").Activity;
    const themed = await themeActivity(ai, "Theme: Circus", activity);
    expect(themed.title).toBe(`Big Top ${activity.title}`);
  });
});
