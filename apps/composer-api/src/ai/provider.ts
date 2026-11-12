import Anthropic from "@anthropic-ai/sdk";

/**
 * The AI provider adapter (ADR-0030 item 1, #103): a system prompt and a prompt in, the text out. Composer only:
 * the Collator never imports it (item 6; `apps/collator/src/no-ai.test.ts`). Prompts carry design documents only,
 * never personal data (item 5): that's the callers' job, and each caller has a test for it.
 */
export interface AiRequest {
  system: string;
  prompt: string;
}

export interface AiProvider {
  /** The model that answers, for the startup line and the key test. */
  readonly model: string;
  complete(request: AiRequest): Promise<string>;
}

/** Anything that stops an answer: a failed request, a declined one, or one cut off. The message is for the editor. */
export class AiError extends Error {
  override name = "AiError";
}

/** The SDK call the adapter makes; tests pass a fake (item 7: no network in CI). */
export type CreateMessage = (
  params: Anthropic.Beta.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Beta.BetaMessage>;

/** Models that take a server-side fallback when they decline (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set([
  "claude-fable-5-2",
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);

/** Claude, through the official SDK. `create` is for tests. */
export function anthropicProvider({
  apiKey,
  model,
  create,
}: {
  apiKey: string;
  model: string;
  create?: CreateMessage;
}): AiProvider {
  const send: CreateMessage =
    create ??
    ((params) => new Anthropic({ apiKey }).beta.messages.create(params));
  return {
    model,
    async complete({ system, prompt }) {
      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await send({
          model,
          max_tokens: 16000,
          system,
          messages: [{ role: "user", content: prompt }],
          // A declined request is re-run on another model inside the same call, where the model allows it.
          ...(FALLBACK_MODELS.has(model) && {
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          }),
        });
      } catch (error) {
        throw new AiError(
          `The AI provider failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (message.stop_reason === "refusal") {
        throw new AiError("The AI declined this request.");
      }
      if (message.stop_reason === "max_tokens") {
        throw new AiError("The AI's answer was cut off. Try again.");
      }
      return message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");
    },
  };
}
