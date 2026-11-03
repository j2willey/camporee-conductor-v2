/** A setting that stops the server from starting. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

export type AuthConfig =
  | { adapter: "clerk"; secretKey: string; publishableKey: string }
  /** Trusts a header for the user: development and test only (issue #4, D7). */
  | { adapter: "dev" };

export interface Config {
  auth: AuthConfig;
  databasePath: string;
  port: number;
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
  return { auth, databasePath: env["DATABASE_PATH"] ?? "composer.db", port };
}
