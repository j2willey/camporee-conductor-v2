import type { AiConfig } from "../config.ts";
import { cannedProvider } from "./fake.ts";
import { anthropicProvider, type AiProvider } from "./provider.ts";

/** The provider the config names, or null when AI is off (ADR-0030 item 2). */
export function aiProviderFor(config: AiConfig): AiProvider | null {
  if (!config) return null;
  return config.adapter === "fake"
    ? cannedProvider()
    : anthropicProvider(config);
}
