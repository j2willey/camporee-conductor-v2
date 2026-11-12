import { randomInt } from "node:crypto";
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
  /** Who may load the first cartridge onto an empty box from the browser (ADR-0027, #100 PR 5, provisional). */
  firstLoad: FirstLoad;
}

/**
 * The first load's rule (ADR-0027, provisional): `code` (the default) needs the box's setup code; `open` needs
 * none, and is only for a box with no internet. Once an Event is loaded, only a Director may load.
 */
export type FirstLoad =
  | { mode: "open" }
  | {
      mode: "code";
      code: string;
      /** Made up at start because SETUP_CODE is unset: the server prints it in its log. */
      generated: boolean;
    };

export interface BackupConfig {
  dir: string;
  everyMinutes: number;
  keep: number;
}

/** Reads the Collator's settings from the environment. */
export function loadConfig(
  env: Record<string, string | undefined>,
  makeCode: () => string = randomSetupCode,
): Config {
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
    firstLoad: firstLoadFrom(env, makeCode),
  };
}

/** FIRST_LOAD (`code`, the default, or `open`) and SETUP_CODE (made up when unset). */
export function firstLoadFrom(
  env: Record<string, string | undefined>,
  makeCode: () => string = randomSetupCode,
): FirstLoad {
  const mode = env["FIRST_LOAD"]?.trim() || "code";
  if (mode === "open") return { mode: "open" };
  if (mode !== "code") {
    throw new ConfigError(
      `FIRST_LOAD must be "code" (the default) or "open" (only for a box with no internet), not "${mode}".`,
    );
  }
  const given = env["SETUP_CODE"]?.trim();
  return given
    ? { mode: "code", code: given, generated: false }
    : { mode: "code", code: makeCode(), generated: true };
}

/** Eight letters and digits in two groups, easy to read aloud: no 0/O or 1/I/L. */
function randomSetupCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const pick = () => alphabet[randomInt(alphabet.length)] ?? "A";
  const group = () => Array.from({ length: 4 }, pick).join("");
  return `${group()}-${group()}`;
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
