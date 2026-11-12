import { AiError, type AiProvider } from "./provider.ts";

export type KeyTest =
  | { ok: true; model: string; reply: string }
  | { ok: false; model: string; error: string };

/**
 * "Test the key" (ADR-0030 item 7): the one live check. One tiny request; the model's answer, or the provider's
 * error. Never the key.
 */
export async function testKey(ai: AiProvider): Promise<KeyTest> {
  try {
    const reply = await ai.complete({
      system: "You check that an API key works. Answer with one word.",
      prompt: "Say OK.",
    });
    return { ok: true, model: ai.model, reply: reply.trim() };
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return { ok: false, model: ai.model, error: error.message };
  }
}
