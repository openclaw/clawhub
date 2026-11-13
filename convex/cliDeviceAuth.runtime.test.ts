/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("cli device login", () => {
  it("keeps the code off the link and mints a full token after the typed code is approved", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => ctx.db.insert("users", { handle: "publisher" }));
    const created = await t.mutation(internal.cliDeviceAuth.createInternal, {
      label: "ssh box",
      scope: "read write",
      siteUrl: "https://clawhub.ai",
    });

    expect(created.verification_uri).toBe("https://clawhub.ai/cli/device");
    expect(created.verification_uri.includes(created.user_code)).toBe(false);
    expect(created.user_code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

    const viewer = t.withIdentity({ subject: userId });
    const described = await viewer.query(api.cliDeviceAuth.describePending, {
      userCode: created.user_code,
    });
    expect(described).toMatchObject({
      state: "pending",
      label: "ssh box",
      access: "full",
    });
    await expect(
      t.mutation(internal.cliDeviceAuth.createInternal, { scope: "read" }),
    ).rejects.toThrow(/full API token/);

    await viewer.mutation(api.cliDeviceAuth.approve, { userCode: created.user_code });
    const token = await t.mutation(internal.cliDeviceAuth.pollInternal, {
      deviceCode: created.device_code,
    });
    expect(token).toMatchObject({ token_type: "bearer", scope: "read write" });
    const accessToken = "access_token" in token ? token.access_token : undefined;
    if (!accessToken) throw new Error("device poll did not return a token");
    expect(accessToken.startsWith("clh_")).toBe(true);
  });

  it("keeps a past expiry pending so approval can close on the page clock", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => ctx.db.insert("users", { handle: "publisher" }));
    const created = await t.mutation(internal.cliDeviceAuth.createInternal, {
      label: "ssh box",
      scope: "read write",
      siteUrl: "https://clawhub.ai",
    });
    const expiredAt = await t.run(async (ctx) => {
      const row = await ctx.db.query("cliDeviceCodes").first();
      if (!row) throw new Error("missing device code");
      const expiresAt = row.createdAt - 1;
      await ctx.db.patch(row._id, { expiresAt });
      return expiresAt;
    });

    const viewer = t.withIdentity({ subject: userId });
    const described = await viewer.query(api.cliDeviceAuth.describePending, {
      userCode: created.user_code,
    });
    expect(described).toMatchObject({
      state: "pending",
      expiresAt: expiredAt,
      access: "full",
    });
    await expect(
      viewer.mutation(api.cliDeviceAuth.approve, { userCode: created.user_code }),
    ).rejects.toThrow(/expired/);
    await expect(
      viewer.mutation(api.cliDeviceAuth.deny, { userCode: created.user_code }),
    ).rejects.toThrow(/expired/);
  });

  it("denies a code that is still pending", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => ctx.db.insert("users", { handle: "publisher" }));
    const created = await t.mutation(internal.cliDeviceAuth.createInternal, {
      scope: "read write",
      siteUrl: "https://clawhub.ai",
    });
    const viewer = t.withIdentity({ subject: userId });
    await expect(
      viewer.mutation(api.cliDeviceAuth.deny, { userCode: created.user_code }),
    ).resolves.toEqual({ ok: true });
    const status = await t.run(async (ctx) => {
      const row = await ctx.db.query("cliDeviceCodes").first();
      return row?.status;
    });
    expect(status).toBe("denied");
  });
});
