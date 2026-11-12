import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";

describe("backup settings (ADR-0027 item 11)", () => {
  it("are off when BACKUP_DIR is unset", () => {
    expect(loadConfig({}).backup).toBeNull();
  });

  it("default to every 5 minutes, keeping a day's worth", () => {
    expect(loadConfig({ BACKUP_DIR: "/media/stick" }).backup).toEqual({
      dir: "/media/stick",
      everyMinutes: 5,
      keep: 288,
    });
  });

  it("take a relative folder from where the command was typed", () => {
    expect(
      loadConfig({ BACKUP_DIR: "backups", INIT_CWD: "/home/jim" }).backup?.dir,
    ).toBe("/home/jim/backups");
  });

  it("take an interval in minutes, fractions allowed, and how many to keep", () => {
    expect(
      loadConfig({
        BACKUP_DIR: "/b",
        BACKUP_EVERY_MINUTES: "0.5",
        BACKUP_KEEP: "12",
      }).backup,
    ).toEqual({ dir: "/b", everyMinutes: 0.5, keep: 12 });
  });

  it.each([
    ["BACKUP_EVERY_MINUTES", "0"],
    ["BACKUP_EVERY_MINUTES", "-1"],
    ["BACKUP_EVERY_MINUTES", "often"],
    ["BACKUP_KEEP", "0"],
    ["BACKUP_KEEP", "2.5"],
  ])("refuse %s=%s", (name, value) => {
    expect(() => loadConfig({ BACKUP_DIR: "/b", [name]: value })).toThrow(
      ConfigError,
    );
  });
});

describe("the first load's setting (ADR-0027, #100 PR 5, provisional)", () => {
  it("needs a setup code by default, made up at start when SETUP_CODE is unset", () => {
    const config = loadConfig({}, () => "ABCD-2345");
    expect(config.firstLoad).toEqual({
      mode: "code",
      code: "ABCD-2345",
      generated: true,
    });
  });

  it("takes the box's own SETUP_CODE", () => {
    expect(loadConfig({ SETUP_CODE: " pine-cone " }).firstLoad).toEqual({
      mode: "code",
      code: "pine-cone",
      generated: false,
    });
  });

  it("is open with FIRST_LOAD=open, for a box with no internet", () => {
    expect(loadConfig({ FIRST_LOAD: "open" }).firstLoad).toEqual({
      mode: "open",
    });
  });

  it("refuses anything else", () => {
    expect(() => loadConfig({ FIRST_LOAD: "yes" })).toThrow(ConfigError);
  });
});
