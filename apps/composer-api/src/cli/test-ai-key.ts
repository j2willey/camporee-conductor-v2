// "Test the key" (ADR-0030 item 7, #103): sends one tiny request with ANTHROPIC_API_KEY and AI_MODEL, and prints the
// model's answer or the error, never the key. The sysadmin's tool until the admin pages (#104).
// Usage: pnpm --filter @camporee-conductor/composer-api test-ai-key   (reads .env.local at the repo root if present)
import { anthropicProvider } from "../ai/provider.ts";
import { testKey } from "../ai/test-key.ts";
import { aiConfigFrom } from "../config.ts";

const ai = aiConfigFrom(process.env);
if (!ai) {
  console.error("ANTHROPIC_API_KEY isn't set, so AI is off.");
  process.exit(1);
}
const result = await testKey(anthropicProvider(ai));
if (result.ok) {
  console.log(`The key works: ${result.model} answered "${result.reply}".`);
} else {
  console.error(`The key test failed (${result.model}): ${result.error}`);
  process.exit(1);
}
