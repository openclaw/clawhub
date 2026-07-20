import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import {
  catalogFeedShardHandler,
  signedCatalogFeedShardRootHandler,
} from "./httpApiV1/catalogFeedShards";

type QueryCtx = { runQuery: ReturnType<typeof vi.fn> };

function signingEnv() {
  const { privateKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return {
    CLAWHUB_FEED_SIGNING_CONFIG: JSON.stringify({
      keyId: "clawhub-feed-2026-q3",
      privateKey,
    }),
  };
}

describe("catalog feed shard HTTP delivery", () => {
  let ctx: QueryCtx;

  beforeEach(() => {
    ctx = { runQuery: vi.fn() };
  });

  it("serves a signed root with immutable digest-addressed public shard URLs", async () => {
    ctx.runQuery.mockResolvedValue({
      feedId: "clawhub-official",
      sequence: 8,
      generatedAt: "2026-07-17T00:00:00.000Z",
      expiresAt: "2026-07-18T00:00:00.000Z",
      description: "Official plugins",
      entryCount: 2,
      shards: [
        {
          index: 0,
          sha256: "a".repeat(64),
          byteLength: 123,
          entryCount: 2,
        },
      ],
    });

    const response = await signedCatalogFeedShardRootHandler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins/root"),
      "clawhub-official",
      signingEnv(),
    );

    expect(response.status).toBe(200);
    const envelope = (await response.json()) as { payloadType: string; payload: string };
    const root = JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8"));
    expect(envelope.payloadType).toBe("openclaw.official-external-plugin-catalog-shard-root.v1");
    expect(root).toMatchObject({ feedId: "clawhub-official", sequence: 8, entryCount: 2 });
    expect(root.shards[0].url).toBe(
      `https://clawhub.ai/v1/feeds/plugins/shards/sha256-${"a".repeat(64)}.json`,
    );
    expect(ctx.runQuery).toHaveBeenCalledWith(
      internal.catalogFeedShards.getLatestCatalogFeedShardPublication,
      { feedId: "clawhub-official" },
    );
  });

  it("uses the serving origin for preview shard URLs", async () => {
    ctx.runQuery.mockResolvedValue({
      feedId: "clawhub-official",
      sequence: 8,
      generatedAt: "2026-07-17T00:00:00.000Z",
      expiresAt: "2026-07-18T00:00:00.000Z",
      description: "Official plugins",
      entryCount: 1,
      shards: [{ index: 0, sha256: "c".repeat(64), byteLength: 123, entryCount: 1 }],
    });

    vi.stubEnv("SITE_URL", "https://preview.example");
    try {
      const response = await signedCatalogFeedShardRootHandler(
        ctx as never,
        new Request("https://paired-preview-123.convex.site/api/v1/feeds/plugins/root"),
        "clawhub-official",
        signingEnv(),
      );

      const envelope = (await response.json()) as { payload: string };
      const root = JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8"));
      expect(root.shards[0].url).toBe(
        `https://preview.example/v1/feeds/plugins/shards/sha256-${"c".repeat(64)}.json`,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("serves exact shard bytes with immutable validators", async () => {
    const payload = '{"schemaVersion":1,"feedId":"clawhub-official"}';
    ctx.runQuery.mockResolvedValue({
      payload,
      sha256: "b".repeat(64),
      byteLength: Buffer.byteLength(payload),
      feedId: "clawhub-official",
      sequence: 8,
      index: 0,
    });
    const request = new Request(
      `https://clawhub.ai/api/v1/feeds/plugins/shards/sha256-${"b".repeat(64)}.json`,
    );

    const response = await catalogFeedShardHandler(ctx as never, request);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(payload);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("etag")).toBe(`"sha256:${"b".repeat(64)}"`);
  });

  it("fails closed before reading a root when signing is not configured", async () => {
    const response = await signedCatalogFeedShardRootHandler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins/root"),
      "clawhub-official",
      {},
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });
});
