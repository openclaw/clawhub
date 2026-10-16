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

async function fixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const token = "blobster-test-token";
  const tokenHash = await hashToken(token);
  const tokenId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "blobster-creator" });
    return ctx.db.insert("apiTokens", {
      userId,
      label: "fixture",
      prefix: "fixture",
      tokenHash,
      createdAt: 1,
    });
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
  return { t, tokenId, generate };
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
    expect((await generate({ prompt: "gardener" })).status).toBe(503);
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
