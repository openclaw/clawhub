/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/httpRateLimit", () => ({
  applyRateLimit: vi.fn(async () => ({ ok: true, headers: { "x-rate-limit": "ok" } })),
}));

const { applyRateLimit } = await import("../lib/httpRateLimit");
const { trendingV1Handler } = await import("./trendingV1");

beforeEach(() => {
  vi.stubEnv("CLAWHUB_ENV", "test");
  vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "test");
  vi.mocked(applyRateLimit).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("canonical Trending HTTP API", () => {
  it("stays dark before rate limiting while the skills.sh rollout is disabled", async () => {
    vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "off");
    const runQuery = vi.fn();

    const response = await trendingV1Handler(
      { runQuery } as never,
      new Request("https://clawhub.ai/api/v1/trending?kind=skills"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(applyRateLimit).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("returns the materialized snapshot envelope without reordering cards", async () => {
    const page = {
      kind: "skills",
      snapshotId: "snap_123",
      snapshotCursor: "snapshot-cursor",
      generatedAt: "2026-07-25T16:00:00.000Z",
      windowHours: 24,
      rankingVersion: "skills-trending-v1",
      items: [
        { id: "clawhub:skills:1", source: "clawhub", displayName: "Native" },
        { id: "skills-sh:owner/repo/skill", source: "skills-sh", displayName: "External" },
      ],
      nextCursor: "next-cursor",
    };
    const runQuery = vi.fn(async () => ({ status: "ok", page }));

    const response = await trendingV1Handler(
      { runQuery } as never,
      new Request(
        "https://academic-chihuahua-392.convex.site/api/v1/trending?kind=skills&limit=2&cursor=current-cursor",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-rate-limit")).toBe("ok");
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      cursor: "current-cursor",
      limit: 2,
    });
    expect(await response.json()).toEqual(page);
  });

  it("rejects unsupported kinds and invalid limits before querying a snapshot", async () => {
    const runQuery = vi.fn();

    const unsupported = await trendingV1Handler(
      { runQuery } as never,
      new Request("https://clawhub.ai/api/v1/trending?kind=plugins"),
    );
    const invalidLimit = await trendingV1Handler(
      { runQuery } as never,
      new Request("https://clawhub.ai/api/v1/trending?kind=skills&limit=0"),
    );

    expect(unsupported.status).toBe(400);
    expect(invalidLimit.status).toBe(400);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("returns 503 until the first ready snapshot exists", async () => {
    const response = await trendingV1Handler(
      { runQuery: vi.fn(async () => ({ status: "unavailable" })) } as never,
      new Request("https://clawhub.ai/api/v1/trending?kind=skills"),
    );

    expect(response.status).toBe(503);
  });

  it("returns 410 when a stable cursor references a pruned snapshot", async () => {
    const response = await trendingV1Handler(
      {
        runQuery: vi.fn(async () => ({ status: "expired" })),
      } as never,
      new Request("https://clawhub.ai/api/v1/trending?cursor=expired"),
    );

    expect(response.status).toBe(410);
  });

  it("returns 400 when the page query rejects a malformed cursor", async () => {
    const response = await trendingV1Handler(
      { runQuery: vi.fn(async () => ({ status: "invalid-cursor" })) } as never,
      new Request("https://clawhub.ai/api/v1/trending?cursor=malformed"),
    );

    expect(response.status).toBe(400);
  });
});
