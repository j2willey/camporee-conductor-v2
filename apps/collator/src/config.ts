import { resolve } from "node:path";

/** A setting that stops the server from starting. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

export interface Config {
  databasePath: string;
  port: number;
}

/** Reads the Collator's settings from the environment. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const port = Number(env["PORT"] ?? 3030);
  if (!Number.isInteger(port) || port < 0) {
    throw new ConfigError(`PORT must be a whole number, not "${env["PORT"]}".`);
  }
  return { databasePath: databasePathFrom(env), port };
}

/**
 * DATABASE_PATH (default `collator.db`). A relative path is from where the command was typed: pnpm runs
 * scripts in the package directory but sets INIT_CWD, so the server and the CLI find the same file.
 */
export function databasePathFrom(
  env: Record<string, string | undefined>,
): string {
  const path = env["DATABASE_PATH"] ?? "collator.db";
  return path === ":memory:" ? path : resolve(env["INIT_CWD"] ?? ".", path);
}
