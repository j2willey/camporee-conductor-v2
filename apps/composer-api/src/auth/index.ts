import type { AuthConfig } from "../config.ts";
import { clerkAuth } from "./clerk.ts";
import { devAuth } from "./dev.ts";
import type { AuthAdapter } from "./types.ts";

export type { AuthAdapter, AuthUser } from "./types.ts";

/** The adapter the config names. `loadConfig` has already refused dev in production. */
export function createAuth(config: AuthConfig): AuthAdapter {
  return config.adapter === "clerk" ? clerkAuth(config) : devAuth();
}
