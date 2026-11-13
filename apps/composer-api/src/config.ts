import { resolve } from "node:path";

/** A setting that stops the server from starting. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

export type AuthConfig =
  | { adapter: "clerk"; secretKey: string; publishableKey: string }
  /** Trusts a header for the user: development and test only (issue #4, D7). */
  | { adapter: "dev" };

/**
 * AI assistance (ADR-0030): Claude with a key, off (null) without one. `fake` gives canned answers, for trying the
 * buttons and for the e2e test; like the dev sign-in, it's refused outside development and test.
 */
export type AiConfig =
  | { adapter: "anthropic"; apiKey: string; model: string }
  | { adapter: "fake" }
  | null;

/** ADR-0030 item 1: Sonnet unless AI_MODEL names another. */
export const DEFAULT_AI_MODEL = "claude-sonnet-5-5";

export interface Config {
  auth: AuthConfig;
  ai: AiConfig;
  databasePath: string;
  port: number;
  /** The built web app to serve, or null in development, where Vite serves it (issue #4, D5). */
  webRoot: string | null;
}

/** Where the dev sign-in adapter may run. Anything else, including no NODE_ENV, is refused. */
const DEV_AUTH_ENVIRONMENTS = new Set(["development", "test"]);

/**
 * Reads the server settings from the environment. Fails closed: the dev sign-in adapter is refused
 * unless NODE_ENV is explicitly `development` or `test`.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const adapter = env["AUTH_ADAPTER"] ?? "clerk";
  const nodeEnv = env["NODE_ENV"];
  let auth: AuthConfig;
  if (adapter === "dev") {
    if (!nodeEnv || !DEV_AUTH_ENVIRONMENTS.has(nodeEnv)) {
      throw new ConfigError(
        `The dev sign-in adapter is refused outside development and test (NODE_ENV=${nodeEnv ?? "unset"}); it must never run in production.`,
      );
    }
    auth = { adapter: "dev" };
  } else if (adapter === "clerk") {
    const secretKey = env["CLERK_SECRET_KEY"];
    const publishableKey = env["CLERK_PUBLISHABLE_KEY"];
    if (!secretKey || !publishableKey) {
      throw new ConfigError(
        "CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY are required when AUTH_ADAPTER is clerk.",
      );
    }
    auth = { adapter: "clerk", secretKey, publishableKey };
  } else {
    throw new ConfigError(
      `AUTH_ADAPTER must be "clerk" or "dev", not "${adapter}".`,
    );
  }
  const port = Number(env["PORT"] ?? 3010);
  if (!Number.isInteger(port) || port < 0) {
    throw new ConfigError(`PORT must be a whole number, not "${env["PORT"]}".`);
  }
  return {
    auth,
    ai: aiConfigFrom(env),
    databasePath: databasePathFrom(env),
    port,
    webRoot: webRootFrom(env),
  };
}

/**
 * AI_ADAPTER (`anthropic` by default, or `fake`), with ANTHROPIC_API_KEY and AI_MODEL. Null (AI off) without a key
 * (ADR-0030 item 2). Fails closed: the fake is refused unless NODE_ENV is `development` or `test`.
 */
export function aiConfigFrom(
  env: Record<string, string | undefined>,
): AiConfig {
  const adapter = env["AI_ADAPTER"]?.trim() || "anthropic";
  if (adapter === "fake") {
    const nodeEnv = env["NODE_ENV"];
    if (!nodeEnv || !DEV_AUTH_ENVIRONMENTS.has(nodeEnv)) {
      throw new ConfigError(
        `The fake AI adapter is refused outside development and test (NODE_ENV=${nodeEnv ?? "unset"}).`,
      );
    }
    return { adapter: "fake" };
  }
  if (adapter !== "anthropic") {
    throw new ConfigError(
      `AI_ADAPTER must be "anthropic" or "fake", not "${adapter}".`,
    );
  }
  const apiKey = env["ANTHROPIC_API_KEY"]?.trim();
  if (!apiKey) return null;
  return {
    adapter: "anthropic",
    apiKey,
    model: env["AI_MODEL"]?.trim() || DEFAULT_AI_MODEL,
  };
}

/** One startup line saying whether AI is on, and which model; never the key. */
export function describeAi(ai: AiConfig): string {
  if (!ai) return "ai: off (no ANTHROPIC_API_KEY)";
  return ai.adapter === "fake"
    ? "ai: fake (canned answers, development only)"
    : `ai: ${ai.model}`;
}

/**
 * One startup line saying which sign-in is active. The Clerk instance comes from the publishable key's
 * prefix (pk_test_ / pk_live_); no key is printed.
 */
export function describeAuth(auth: AuthConfig): string {
  if (auth.adapter === "dev") {
    return "auth: dev sign-in (x-dev-user header, development only)";
  }
  const instance = auth.publishableKey.startsWith("pk_live_")
    ? "production"
    : auth.publishableKey.startsWith("pk_test_")
      ? "development"
      : "unknown";
  return `auth: clerk (${instance} instance)`;
}

/**
 * DATABASE_PATH (default `composer.db`). A relative path is from where the command was typed: pnpm runs
 * scripts in the package directory but sets INIT_CWD, so the server and the import CLI find the same file.
 */
export function databasePathFrom(
  env: Record<string, string | undefined>,
): string {
  const path = env["DATABASE_PATH"] ?? "composer.db";
  return path === ":memory:" ? path : resolve(env["INIT_CWD"] ?? ".", path);
}

/** WEB_ROOT, the built web app's folder, resolved like DATABASE_PATH; unset means don't serve it. */
export function webRootFrom(
  env: Record<string, string | undefined>,
): string | null {
  const path = env["WEB_ROOT"];
  return path ? resolve(env["INIT_CWD"] ?? ".", path) : null;
}
