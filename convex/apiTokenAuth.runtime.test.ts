/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import {
  BLOCKED_API_TOKEN_ACCOUNT_MESSAGE,
  getOptionalApiTokenUserId,
  INVALID_API_TOKEN_MESSAGE,
  requireApiTokenUser,
} from "./lib/apiTokenAuth";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

it.each(["revoked", "deleted", "deactivated", "missing"] as const)(
  "observes %s token/account state on the next request and required authorization",
  async (state) => {
    const t = convexTest(schema, modules);
    const token = "local-auth-snapshot-fixture";
    const tokenHash = await hashToken(token);
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { handle: "auth-fixture" });
      const tokenId = await ctx.db.insert("apiTokens", {
        userId,
        label: "fixture",
        prefix: "fixture",
        tokenHash,
        createdAt: 1,
      });
      return { userId, tokenId };
    });
    const actionCtx = { runQuery: t.query, runMutation: t.mutation } as ActionCtx;
    const request = new Request("https://example.com", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await getOptionalApiTokenUserId(actionCtx, request)).toBe(seeded.userId);
    expect(await requireApiTokenUser(actionCtx, request)).toMatchObject({
      userId: seeded.userId,
      apiTokenId: seeded.tokenId,
    });
    const touched = await t.run((ctx) => ctx.db.get(seeded.tokenId));
    expect(touched?.lastUsedAt).toBeGreaterThan(1);

    await t.run(async (ctx) => {
      if (state === "revoked") await ctx.db.patch(seeded.tokenId, { revokedAt: 1 });
      else if (state === "missing") await ctx.db.delete(seeded.userId);
      else
        await ctx.db.patch(seeded.userId, {
          [state === "deleted" ? "deletedAt" : "deactivatedAt"]: 1,
        });
    });
    expect(await getOptionalApiTokenUserId(actionCtx, request.clone())).toBeNull();
    await expect(requireApiTokenUser(actionCtx, request)).rejects.toThrow(
      state === "revoked" ? INVALID_API_TOKEN_MESSAGE : BLOCKED_API_TOKEN_ACCOUNT_MESSAGE,
    );
    expect(
      await t.query(internal.tokens.getAuthByHashInternal, { tokenHash: "unknown" }),
    ).toBeNull();
  },
);
