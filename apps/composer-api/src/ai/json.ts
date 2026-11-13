import { z } from "zod";
import { AiError, type AiProvider, type AiRequest } from "./provider.ts";

/**
 * Asks for an answer in `schema` (structured outputs) and checks it with the same Zod schema (ADR-0030 notes,
 * #103 PR 2). An answer that doesn't fit is an AiError, never a guess.
 */
export async function completeJson<T extends z.ZodType>(
  ai: AiProvider,
  request: Omit<AiRequest, "schema">,
  schema: T,
): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema["$schema"];
  const text = await ai.complete({ ...request, schema: jsonSchema });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AiError(
      "The AI's answer wasn't in the expected form. Try again.",
    );
  }
  return result.data;
}
