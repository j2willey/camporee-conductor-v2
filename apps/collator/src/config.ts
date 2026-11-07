import { resolve } from "node:path";

/** A setting that stops the server from starting. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

export interface Config {
  databasePath: string;
  port: number;
  /** The built web app to serve, or null in development, where Vite serves it. */
  webRoot: string | null;
  /** Periodic backups to a folder (ADR-0027 item 11), or null when BACKUP_DIR is unset. */
  backup: BackupConfig | null;
}

export interface BackupConfig {
  dir: string;
  everyMinutes: number;
  keep: number;
}

/** Reads the Collator's settings from the environment. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const port = Number(env["PORT"] ?? 3030);
  if (!Number.isInteger(port) || port < 0) {
    throw new ConfigError(`PORT must be a whole number, not "${env["PORT"]}".`);
  }
  const webRoot = env["WEB_ROOT"];
  return {
    databasePath: databasePathFrom(env),
    port,
    webRoot: webRoot ? resolve(env["INIT_CWD"] ?? ".", webRoot) : null,
    backup: backupConfigFrom(env),
  };
}

/**
 * BACKUP_DIR (off when unset; a relative path is from where the command was typed), BACKUP_EVERY_MINUTES
 * (default 5) and BACKUP_KEEP (default 288: a day's worth at 5 minutes).
 */
export function backupConfigFrom(
  env: Record<string, string | undefined>,
): BackupConfig | null {
  const dir = env["BACKUP_DIR"];
  if (!dir) return null;
  const everyMinutes = Number(env["BACKUP_EVERY_MINUTES"] ?? 5);
  if (!Number.isFinite(everyMinutes) || everyMinutes <= 0) {
    throw new ConfigError(
      `BACKUP_EVERY_MINUTES must be a number of minutes above 0, not "${env["BACKUP_EVERY_MINUTES"]}".`,
    );
  }
  const keep = Number(env["BACKUP_KEEP"] ?? 288);
  if (!Number.isInteger(keep) || keep < 1) {
    throw new ConfigError(
      `BACKUP_KEEP must be a whole number of 1 or more, not "${env["BACKUP_KEEP"]}".`,
    );
  }
  return { dir: resolve(env["INIT_CWD"] ?? ".", dir), everyMinutes, keep };
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
