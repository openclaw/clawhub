/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
const modules = import.meta.glob("./**/*.ts");
const path = "/api/v1/blobsters/generate";
const design = {
  version: 1,
  id: "gardener",
  name: "Gardener",
  description: "A friendly gardener",
  palette: { shell: "#87b891", claw: "#5b9471", glint: "#fff0b3" },
  layers: { back: "", left_prop: "", right_prop: "", shell_overlay: "", accessory: "" },
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const token = "blobster-test-token";
  const tokenHash = await hashToken(token);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "blobster-creator" });
    const tokenId = await ctx.db.insert("apiTokens", {
      userId,
      label: "fixture",
      prefix: "fixture",
      tokenHash,
      createdAt: 1,
    });
    return { tokenId, userId };
  });
  const generate = (body: unknown, auth = true) =>
    t.fetch(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  return { t, ...ids, token, generate };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Blobster HTTP boundary", () => {
  it("requires a current account token before calling the provider", async () => {
    const { t, tokenId, generate } = await fixture();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect((await generate({ prompt: "gardener" }, false)).status).toBe(401);
    await t.run((ctx) => ctx.db.patch(tokenId, { revokedAt: 1 }));
    expect((await generate({ prompt: "gardener" })).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["active", "revoked", "deactivated", "deleted"] as const)(
    "revalidates %s authority after an admitted request body stalls",
    async (authority) => {
      const { t, tokenId, userId, token } = await fixture();
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      const fetcher = vi.fn(async () =>
        Response.json({
          output: [
            { type: "message", content: [{ type: "output_text", text: JSON.stringify(design) }] },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetcher);
      const reading = deferred();
      const release = deferred();
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            reading.resolve();
            await release.promise;
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ prompt: "gardener" })));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      const request = {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body,
        duplex: "half" as const,
      };
      const response = t.fetch(path, request);
      await Promise.race([
        reading.promise,
        response.then(() => {
          throw new Error("Request ended before reading its body");
        }),
      ]);
      try {
        // Token touch proves real admission completed before the body pause.
        expect(await t.run(async (ctx) => (await ctx.db.get(tokenId))?.lastUsedAt)).toBeDefined();
        expect(fetcher).not.toHaveBeenCalled();
        await t.run(async (ctx) => {
          if (authority === "revoked") await ctx.db.patch(tokenId, { revokedAt: Date.now() });
          if (authority === "deactivated")
            await ctx.db.patch(userId, { deactivatedAt: Date.now() });
          if (authority === "deleted") await ctx.db.patch(userId, { deletedAt: Date.now() });
        });
      } finally {
        release.resolve();
      }
      expect({ status: (await response).status, providerCalls: fetcher.mock.calls.length }).toEqual(
        {
          status: authority === "active" ? 200 : 401,
          providerCalls: authority === "active" ? 1 : 0,
        },
      );
    },
  );

  it.each([
    { prompt: "" },
    { prompt: "a".repeat(8_001) },
    { prompt: "gardener", soul: "not approved" },
    null,
    { prompt: "a".repeat(32_001) },
  ])("rejects invalid or extra input", async (body) => {
    const { generate } = await fixture();
    expect((await generate(body)).status).toBe(400);
  });

  it("returns a bounded, private, static SVG and rate limits repeated generation", async () => {
    const { generate } = await fixture();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetcher = vi.fn(async () =>
      Response.json({
        output: [
          { type: "message", content: [{ type: "output_text", text: JSON.stringify(design) }] },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const first = await generate({ prompt: "gardener" });
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    expect(first.headers.get("RateLimit-Limit")).toBe("6");
    expect(await first.json()).toMatchObject({
      name: "Gardener",
      svg: expect.stringContaining("<svg"),
    });
    for (let i = 0; i < 5; i++) expect((await generate({ prompt: "gardener" })).status).toBe(200);
    expect((await generate({ prompt: "gardener" })).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it("reports unconfigured generation and masks provider failures", async () => {
    const { generate } = await fixture();
    vi.stubEnv("OPENAI_API_KEY", "");
    const unconfigured = await generate({ prompt: "gardener" });
    expect(unconfigured.status).toBe(503);
    expect(await unconfigured.text()).toContain("Contact the instance operator");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("private provider detail");
      }),
    );
    const response = await generate({ prompt: "gardener" });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private provider detail");
  });
});
