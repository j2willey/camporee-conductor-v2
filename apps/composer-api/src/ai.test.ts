import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import { fakeProvider } from "./ai/fake.ts";
import { testDb } from "./test-support.ts";

/** With no key, no AI (ADR-0030 item 2): `/api/me` tells the web app whether to show the AI buttons. */

const me = async (app: ReturnType<typeof createApp>) =>
  (await (
    await app.request("/api/me", {
      headers: { [DEV_USER_HEADER]: "cora@example.com" },
    })
  ).json()) as { ai: boolean };

describe("/api/me", () => {
  it("says ai: false without a provider", async () => {
    const app = createApp({
      db: testDb(),
      auth: devAuth(),
      authConfig: { adapter: "dev" },
    });
    expect((await me(app)).ai).toBe(false);
  });

  it("says ai: true with one", async () => {
    const app = createApp({
      db: testDb(),
      auth: devAuth(),
      authConfig: { adapter: "dev" },
      ai: fakeProvider(() => "x"),
    });
    expect((await me(app)).ai).toBe(true);
  });
});
