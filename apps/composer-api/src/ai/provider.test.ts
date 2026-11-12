import { describe, expect, it } from "vitest";
import { AiError, anthropicProvider, type CreateMessage } from "./provider.ts";

/** The Anthropic adapter (ADR-0030 items 1 and 7): one request in, the text out. No network: `create` is faked. */

type Params = Parameters<CreateMessage>[0];

function fakeCreate(reply: {
  stop_reason: string;
  content: { type: string; text?: string; thinking?: string }[];
}) {
  const calls: Params[] = [];
  const create = (async (params: Params) => {
    calls.push(params);
    return reply;
  }) as unknown as CreateMessage;
  return { calls, create };
}

const answer = (text: string) => ({
  stop_reason: "end_turn",
  content: [
    { type: "thinking", thinking: "" },
    { type: "text", text },
  ],
});

describe("anthropicProvider", () => {
  it("sends the system prompt and the prompt to the model, and returns the text", async () => {
    const { calls, create } = fakeCreate(answer("Under the Big Top"));
    const ai = anthropicProvider({
      apiKey: "sk-ant-x",
      model: "claude-sonnet-5-5",
      create,
    });
    expect(ai.model).toBe("claude-sonnet-5-5");
    expect(await ai.complete({ system: "S", prompt: "P" })).toBe(
      "Under the Big Top",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: "claude-sonnet-5-5",
      system: "S",
      messages: [{ role: "user", content: "P" }],
      max_tokens: 16000,
    });
  });

  it("joins several text blocks", async () => {
    const { create } = fakeCreate({
      stop_reason: "end_turn",
      content: [
        { type: "text", text: "Big " },
        { type: "text", text: "Top" },
      ],
    });
    const ai = anthropicProvider({ apiKey: "k", model: "m", create });
    expect(await ai.complete({ system: "S", prompt: "P" })).toBe("Big Top");
  });

  it("asks for a server-side fallback on a model that has them, and not on others", async () => {
    const sonnet = fakeCreate(answer("x"));
    await anthropicProvider({
      apiKey: "k",
      model: "claude-sonnet-5-5",
      create: sonnet.create,
    }).complete({ system: "S", prompt: "P" });
    expect(sonnet.calls[0]).toMatchObject({
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    const haiku = fakeCreate(answer("x"));
    await anthropicProvider({
      apiKey: "k",
      model: "claude-haiku-5-5",
      create: haiku.create,
    }).complete({ system: "S", prompt: "P" });
    expect(haiku.calls[0]).not.toHaveProperty("fallbacks");
    expect(haiku.calls[0]).not.toHaveProperty("betas");
  });

  it("makes a declined request an error, never a proposal", async () => {
    const { create } = fakeCreate({ stop_reason: "refusal", content: [] });
    const ai = anthropicProvider({ apiKey: "k", model: "m", create });
    await expect(ai.complete({ system: "S", prompt: "P" })).rejects.toThrow(
      AiError,
    );
    await expect(ai.complete({ system: "S", prompt: "P" })).rejects.toThrow(
      "declined",
    );
  });

  it("makes a cut-off answer an error", async () => {
    const { create } = fakeCreate({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: "half an ans" }],
    });
    const ai = anthropicProvider({ apiKey: "k", model: "m", create });
    await expect(ai.complete({ system: "S", prompt: "P" })).rejects.toThrow(
      "cut off",
    );
  });

  it("makes a failed request an AiError with the provider's message", async () => {
    const create = (async () => {
      throw new Error("401 invalid x-api-key");
    }) as unknown as CreateMessage;
    const ai = anthropicProvider({ apiKey: "k", model: "m", create });
    const error = await ai
      .complete({ system: "S", prompt: "P" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as Error).message).toContain("invalid x-api-key");
  });
});
