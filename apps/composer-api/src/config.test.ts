import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  databasePathFrom,
  describeAuth,
  loadConfig,
} from "./config.ts";

const clerk = {
  CLERK_SECRET_KEY: "sk_test_x",
  CLERK_PUBLISHABLE_KEY: "pk_test_x",
};

describe("loadConfig", () => {
  it("uses Clerk by default", () => {
    expect(loadConfig({ NODE_ENV: "production", ...clerk }).auth).toEqual({
      adapter: "clerk",
      secretKey: "sk_test_x",
      publishableKey: "pk_test_x",
    });
  });

  it("requires the Clerk keys when Clerk is the adapter", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(
      /CLERK_SECRET_KEY/,
    );
  });

  it("allows the dev sign-in adapter in development and test", () => {
    for (const NODE_ENV of ["development", "test"]) {
      expect(loadConfig({ NODE_ENV, AUTH_ADAPTER: "dev" }).auth).toEqual({
        adapter: "dev",
      });
    }
  });

  it("refuses the dev sign-in adapter in production (fails closed)", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", AUTH_ADAPTER: "dev", ...clerk }),
    ).toThrow(ConfigError);
  });

  it("refuses the dev sign-in adapter when NODE_ENV isn't set (fails closed)", () => {
    expect(() => loadConfig({ AUTH_ADAPTER: "dev" })).toThrow(ConfigError);
  });

  it("refuses an unknown adapter", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "test", AUTH_ADAPTER: "none" }),
    ).toThrow(/AUTH_ADAPTER/);
  });

  it("reads the database path and port, with defaults", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      AUTH_ADAPTER: "dev",
      INIT_CWD: "/repo",
    });
    expect(config.databasePath).toBe("/repo/composer.db");
    expect(config.port).toBe(3010);
    expect(
      loadConfig({
        NODE_ENV: "test",
        AUTH_ADAPTER: "dev",
        DATABASE_PATH: "/data/x.db",
        PORT: "8080",
      }),
    ).toMatchObject({ databasePath: "/data/x.db", port: 8080 });
  });
});

describe("describeAuth", () => {
  const clerkAuth = (publishableKey: string) =>
    ({ adapter: "clerk", secretKey: "sk_x", publishableKey }) as const;

  it("names the Clerk instance from the publishable key, never printing a key", () => {
    expect(describeAuth(clerkAuth("pk_test_abc"))).toBe(
      "auth: clerk (development instance)",
    );
    expect(describeAuth(clerkAuth("pk_live_abc"))).toBe(
      "auth: clerk (production instance)",
    );
    expect(describeAuth(clerkAuth("abc"))).toBe(
      "auth: clerk (unknown instance)",
    );
  });

  it("says plainly when the dev sign-in is on", () => {
    expect(describeAuth({ adapter: "dev" })).toBe(
      "auth: dev sign-in (x-dev-user header, development only)",
    );
  });
});

describe("databasePathFrom", () => {
  it("resolves a relative path from where pnpm was run (INIT_CWD), so the server and CLI agree", () => {
    expect(databasePathFrom({ INIT_CWD: "/repo" })).toBe("/repo/composer.db");
    expect(
      databasePathFrom({ INIT_CWD: "/repo", DATABASE_PATH: "data/x.db" }),
    ).toBe("/repo/data/x.db");
    expect(
      databasePathFrom({ INIT_CWD: "/repo", DATABASE_PATH: "/data/x.db" }),
    ).toBe("/data/x.db");
  });

  it("keeps :memory: as is", () => {
    expect(databasePathFrom({ DATABASE_PATH: ":memory:" })).toBe(":memory:");
  });
});

describe("the server", () => {
  it("refuses to start with the dev sign-in adapter in production", () => {
    const result = spawnSync(
      process.execPath,
      [new URL("./main.ts", import.meta.url).pathname],
      {
        env: {
          PATH: process.env["PATH"],
          NODE_ENV: "production",
          AUTH_ADAPTER: "dev",
          DATABASE_PATH: ":memory:",
          PORT: "0",
          ...clerk,
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/dev sign-in adapter.*production/i);
  });
});
