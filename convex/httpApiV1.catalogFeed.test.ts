import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { catalogFeedV1Handler } from "./httpApiV1/catalogFeedV1";

type QueryCtx = {
  runQuery: ReturnType<typeof vi.fn>;
};

const publication = {
  feedId: "clawhub-official",
  sequence: 4,
  generatedAt: "2026-06-23T00:00:00.000Z",
  expiresAt: "2026-06-30T00:00:00.000Z",
  payload: '{"schemaVersion":1,"id":"clawhub-official","entries":[]}',
  payloadSha256: "abc123",
  publishedAt: Date.parse("2026-06-23T00:00:00.000Z"),
};

describe("catalogFeedV1Handler", () => {
  let ctx: QueryCtx;

  beforeEach(() => {
    ctx = { runQuery: vi.fn().mockResolvedValue(publication) };
  });

  it("serves the exact published payload with edge cache validators", async () => {
    const response = await catalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/feed"),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(publication.payload);
    expect(response.headers.get("etag")).toBe('"sha256:abc123"');
    expect(response.headers.get("last-modified")).toBe("Tue, 23 Jun 2026 00:00:00 GMT");
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(response.headers.get("surrogate-control")).toContain("stale-while-revalidate=86400");
    expect(ctx.runQuery).toHaveBeenCalledWith(internal.catalogFeed.getLatestPublication, {});
  });

  it("returns 304 for a matching validator", async () => {
    const response = await catalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/feed", {
        headers: { "If-None-Match": '"sha256:abc123"' },
      }),
    );

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("does not cache an unpublished feed", async () => {
    ctx.runQuery.mockResolvedValue(null);
    const response = await catalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/feed"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
