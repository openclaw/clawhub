/// <reference types="vite/client" />
/* @vitest-environment node */

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import { createHttpClient } from "../packages/clawhub/src/http";
import { internal } from "./_generated/api";
import { skillsPostRouterV1Handler } from "./httpApiV1/skillsV1";
import { hashToken } from "./lib/tokens";
import schema from "./schema";
import { consumeSkillPublishUploads } from "./skillPublishUploads";

const modules = import.meta.glob("./**/*.ts");
const bytes = new TextEncoder().encode("hello");
const sha256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
// Captured independently of the publisher report; injected before native storage runs.
const capacityMessage = "CommitterFullError: Too many writes in a short period of time.";

async function fixture(
  failures = 0,
  stage: "store" | "attach" = "store",
  message = capacityMessage,
) {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", { handle: "upload-containment-fixture" });
    await ctx.db.insert("apiTokens", {
      userId: id,
      label: "fixture",
      prefix: "fixture",
      tokenHash: await hashToken("upload-containment-fixture"),
      createdAt: Date.now(),
    });
    return id;
  });
  const { uploadTicket } = await t.mutation(
    internal.skillPublishUploads.createSkillPublishUploadInternal,
    { userId, path: "SKILL.md", size: bytes.length, sha256 },
  );
  const statuses: number[] = [];
  const retryDelays: number[] = [];
  let stores = 0,
    attaches = 0,
    attempts = 0;
  const client = createHttpClient({
    runtime: "node",
    configureDispatcher: false,
    random: () => 0,
    // Run retry sleeps immediately but record them; request deadlines never fire.
    setTimeoutImpl: ((callback: () => void, ms: number) => {
      if (ms === 15_000 || ms === 120_000) return 0;
      retryDelays.push(ms);
      callback();
      return 0;
    }) as unknown as typeof setTimeout,
    clearTimeoutImpl: (() => undefined) as typeof clearTimeout,
    fetchImpl: async (input, init) => {
      attempts += 1;
      let response: Response | undefined;
      await t.action(async (ctx) => {
        const store = ctx.storage.store.bind(ctx.storage);
        ctx.storage.store = async (blob) => {
          stores += 1;
          if (stage === "store" && attempts <= failures) throw new Error(message);
          return store(blob);
        };
        const runMutation = ctx.runMutation.bind(ctx);
        ctx.runMutation = async (ref, args) => {
          if (getFunctionName(ref) === "skillPublishUploads:attachSkillPublishUploadInternal") {
            attaches += 1;
            if (stage === "attach" && attempts <= failures) throw new Error(message);
          }
          return runMutation(ref, args);
        };
        response = await skillsPostRouterV1Handler(ctx, new Request(input, init));
      });
      if (!response) throw new Error("Upload handler did not return a response");
      statuses.push(response.status);
      return response;
    },
  });
  return {
    t,
    userId,
    uploadTicket,
    statuses,
    retryDelays,
    calls: () => ({ stores, attaches }),
    upload: (overrides: { bytes?: Uint8Array; token?: string } = {}) =>
      client.uploadBinary<{ storageId: string }>({
        url: `https://upload-fixture.convex.site/api/v1/skills/-/upload/${uploadTicket}`,
        token: "upload-containment-fixture",
        contentType: "text/markdown",
        bytes,
        ...overrides,
      }),
  };
}

describe("transient skill upload failures through the real shared CLI retry policy", () => {
  it("retries typed storage rejection and attaches the exact bytes once", async () => {
    const f = await fixture(1);
    const result = await f.upload();
    expect(f.statuses).toEqual([503, 200]);
    // The 503 carries Retry-After, which the CLI honors before retrying.
    expect(f.retryDelays).toEqual([2_000]);
    expect(f.calls()).toEqual({ stores: 2, attaches: 1 });
    expect(await f.t.run((ctx) => ctx.db.get(f.uploadTicket))).toMatchObject({
      storageId: result.storageId,
      sha256,
      userId: f.userId,
    });
    expect(await f.t.run(async (ctx) => (await ctx.storage.get(result.storageId))?.text())).toBe(
      "hello",
    );
    expect(
      (await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).map((blob) => blob._id),
    ).toEqual([result.storageId]);
  });

  it("exhausts the unchanged three HTTP attempts before creating any blob", async () => {
    const f = await fixture(10);
    await expect(f.upload()).rejects.toThrow("Too many writes");
    expect(f.statuses).toEqual([503, 503, 503]);
    expect(f.calls()).toEqual({ stores: 3, attaches: 0 });
    expect(await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).toEqual([]);
    expect(await f.t.run((ctx) => ctx.db.get(f.uploadTicket))).not.toHaveProperty("storageId");
  });

  it.each(["Too many writes in a short period of time.", "Invalid storage request"])(
    "keeps unclassified storage failure nonretryable: %s",
    async (message) => {
      const f = await fixture(10, "store", message);
      await expect(f.upload()).rejects.toThrow(message);
      expect(f.statuses).toEqual([400]);
      expect(f.calls()).toEqual({ stores: 1, attaches: 0 });
    },
  );

  it.each([
    capacityMessage,
    "InternalServerError: Transient error while running generate upload url",
    "Your request couldn't be completed. Try again later.",
  ])("retries a transient platform failure while storing: %s", async (message) => {
    const f = await fixture(1, "store", message);
    const result = await f.upload();
    expect(f.statuses).toEqual([503, 200]);
    expect(f.calls()).toEqual({ stores: 2, attaches: 1 });
    expect(
      (await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).map((blob) => blob._id),
    ).toEqual([result.storageId]);
  });

  it("retries a transient attachment failure and keeps exactly one attached blob", async () => {
    const f = await fixture(1, "attach");
    const result = await f.upload();
    expect(f.statuses).toEqual([503, 200]);
    expect(f.calls()).toEqual({ stores: 2, attaches: 2 });
    // The failed attempt's blob was reclaimed; only the attached one remains.
    expect(
      (await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).map((blob) => blob._id),
    ).toEqual([result.storageId]);
    expect(await f.t.run((ctx) => ctx.db.get(f.uploadTicket))).toMatchObject({
      storageId: result.storageId,
    });
  });

  it("bounds persistent attachment failures and leaves no blob behind", async () => {
    const f = await fixture(10, "attach");
    await expect(f.upload()).rejects.toThrow("ClawHub backend is temporarily unavailable");
    expect(f.statuses).toEqual([503, 503, 503]);
    expect(f.calls()).toEqual({ stores: 3, attaches: 3 });
    expect(await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).toEqual([]);
    expect(await f.t.run((ctx) => ctx.db.get(f.uploadTicket))).not.toHaveProperty("storageId");
  });

  it.each(["jello", "hell", "hello!"])("rejects invalid bytes before storage: %s", async (text) => {
    const f = await fixture();
    await expect(f.upload({ bytes: new TextEncoder().encode(text) })).rejects.toThrow();
    expect(f.statuses).toEqual([text.length > 5 ? 413 : 400]);
    expect(f.calls()).toEqual({ stores: 0, attaches: 0 });
  });

  it.each(["expired", "used"] as const)("keeps %s tickets nonretryable", async (kind) => {
    const f = await fixture();
    await f.t.run((ctx) =>
      ctx.db.patch(
        f.uploadTicket,
        kind === "expired" ? { expiresAt: Date.now() - 1 } : { usedAt: Date.now() },
      ),
    );
    await expect(f.upload()).rejects.toThrow("missing, used, or expired");
    expect(f.statuses).toEqual([400]);
    expect(f.calls()).toEqual({ stores: 0, attaches: 0 });
  });

  it("rejects unauthenticated uploads before storage", async () => {
    const f = await fixture();
    await expect(f.upload({ token: "invalid-fixture-token" })).rejects.toThrow();
    expect(f.statuses).toEqual([401]);
    expect(f.calls()).toEqual({ stores: 0, attaches: 0 });
  });

  it("preserves exact hash, ownership and single ticket consumption after a storage retry", async () => {
    const f = await fixture(1);
    const result = await f.upload();
    const other = await f.t.run((ctx) => ctx.db.insert("users", { handle: "other-upload-owner" }));
    const files = [
      { path: "SKILL.md", size: bytes.length, sha256, storageId: result.storageId as never },
    ];
    for (const mismatch of [
      { userId: other, files },
      { userId: f.userId, files: [{ ...files[0], path: "other.md" }] },
      { userId: f.userId, files: [{ ...files[0], sha256: "a".repeat(64) }] },
    ]) {
      await expect(
        f.t.run((ctx) =>
          consumeSkillPublishUploads(ctx, { uploadTickets: [f.uploadTicket], ...mismatch }),
        ),
      ).rejects.toThrow("does not match this publish");
      expect(await f.t.run((ctx) => ctx.db.get(f.uploadTicket))).not.toHaveProperty("usedAt");
    }
    await f.t.run((ctx) =>
      consumeSkillPublishUploads(ctx, { userId: f.userId, uploadTickets: [f.uploadTicket], files }),
    );
    await expect(f.upload()).rejects.toThrow("missing, used, or expired");
    expect(
      (await f.t.run((ctx) => ctx.db.system.query("_storage").collect())).map((blob) => blob._id),
    ).toEqual([result.storageId]);
  });
});
