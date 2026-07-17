import { createHash, generateKeyPairSync } from "node:crypto";
import { CATALOG_FEED_QUERY_PAYLOAD_TYPE, type CatalogFeedEntry } from "clawhub-schema";
import { describe, expect, it, vi } from "vitest";
import { signedCatalogFeedQueryHandler } from "./httpApiV1/catalogFeedQuery";

async function signingEnv() {
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

async function signedPayload(response: Response) {
  const envelope = (await response.json()) as {
    payloadType: string;
    payload: string;
    signatures: Array<Record<string, unknown>>;
  };
  expect(Object.keys(envelope).sort()).toEqual(["payload", "payloadType", "signatures"]);
  expect(Object.keys(envelope.signatures[0] ?? {}).sort()).toEqual(["keyid", "sig"]);
  expect(envelope.payloadType).toBe(CATALOG_FEED_QUERY_PAYLOAD_TYPE);
  return JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

function entry(id: string): CatalogFeedEntry {
  return {
    type: "plugin",
    id,
    title: id,
    version: "1.0.0",
    state: "available",
    publisher: { id: "openclaw", trust: "official" },
    install: {
      candidates: [
        {
          sourceRef: "npm",
          package: id,
          version: "1.0.0",
          integrity: `sha256:${id}`,
        },
      ],
    },
  };
}

describe("signed catalog feed query", () => {
  it("materializes once and signs a revision-pinned paginated result", async () => {
    const env = await signingEnv();
    const normalizedQuery = JSON.stringify({ text: "CUDA", types: ["plugin"] });
    const querySha256 = createHash("sha256").update(normalizedQuery).digest("hex");
    const materializationExpirationTime = Date.now() + 60_000;
    const runAction = vi.fn(async () => ({
      materializationKey: "a".repeat(64),
      sequence: 7,
      query: normalizedQuery,
      querySha256,
      resultCount: 2,
      expirationTime: materializationExpirationTime,
    }));
    const runQuery = vi.fn(async (_reference, args: Record<string, unknown>) => {
      const pagination = args.paginationOpts as { cursor: string | null };
      return pagination.cursor === null
        ? {
            unavailable: false,
            resultCount: 2,
            query: normalizedQuery,
            expirationTime: Date.now() + 60_000,
            page: [{ ordinal: 0, payload: JSON.stringify(entry("@openclaw/cuda")) }],
            isDone: false,
            continueCursor: "convex-page-2",
          }
        : {
            unavailable: false,
            resultCount: 2,
            query: normalizedQuery,
            expirationTime: Date.now() + 60_000,
            page: [{ ordinal: 1, payload: JSON.stringify(entry("@openclaw/cuda-tools")) }],
            isDone: true,
            continueCursor: "",
          };
    });
    const ctx = { runAction, runQuery };
    const firstResponse = await signedCatalogFeedQueryHandler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins/query?q=%20CUDA%20&type=plugin&limit=1"),
      env,
    );

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get("cache-control")).toBe("private, no-store");
    const first = await signedPayload(firstResponse);
    expect(first).toMatchObject({
      feedId: "clawhub-official",
      sequence: 7,
      query: { text: "CUDA", types: ["plugin"] },
      requestCursor: null,
      pageIndex: 0,
      startIndex: 0,
      resultCount: 2,
      expiresAt: new Date(materializationExpirationTime).toISOString(),
    });
    const nextCursor = String(first.nextCursor);

    const secondResponse = await signedCatalogFeedQueryHandler(
      ctx as never,
      new Request(
        `https://clawhub.ai/api/v1/feeds/plugins/query?cursor=${encodeURIComponent(nextCursor)}`,
      ),
      env,
    );
    expect(secondResponse.status).toBe(200);
    expect(await signedPayload(secondResponse)).toMatchObject({
      requestCursor: nextCursor,
      pageIndex: 1,
      startIndex: 1,
      resultCount: 2,
      nextCursor: null,
    });
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(runQuery.mock.calls.at(-1)?.[1]).toMatchObject({
      materializationKey: "a".repeat(64),
      sequence: 7,
      querySha256,
      paginationOpts: { cursor: "convex-page-2", numItems: 1 },
    });

    runAction.mockClear();
    runQuery.mockClear();
    const replacement = nextCursor.endsWith("A") ? "B" : "A";
    const tampered = `${nextCursor.slice(0, -1)}${replacement}`;
    const tamperedResponse = await signedCatalogFeedQueryHandler(
      ctx as never,
      new Request(
        `https://clawhub.ai/api/v1/feeds/plugins/query?cursor=${encodeURIComponent(tampered)}`,
      ),
      env,
    );
    expect(tamperedResponse.status).toBe(400);
    expect(runAction).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("rejects unfiltered requests before materializing", async () => {
    const runAction = vi.fn();
    const runQuery = vi.fn();
    const response = await signedCatalogFeedQueryHandler(
      { runAction, runQuery } as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins/query"),
      await signingEnv(),
    );

    expect(response.status).toBe(400);
    expect(runAction).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("keeps continuation cursors bounded for the largest valid publisher filter", async () => {
    const publisherIds = Array.from({ length: 100 }, (_, index) =>
      index === 0 ? "openclaw" : `${String(index).padStart(3, "0")}-${"p".repeat(252)}`,
    ).sort();
    const normalizedQuery = JSON.stringify({ publisherIds });
    const querySha256 = createHash("sha256").update(normalizedQuery).digest("hex");
    const runAction = vi.fn(async () => ({
      materializationKey: "c".repeat(64),
      sequence: 8,
      query: normalizedQuery,
      querySha256,
      resultCount: 2,
      expirationTime: Date.now() + 60_000,
    }));
    const runQuery = vi.fn(async () => ({
      unavailable: false,
      resultCount: 2,
      query: normalizedQuery,
      expirationTime: Date.now() + 60_000,
      page: [{ ordinal: 0, payload: JSON.stringify(entry("@openclaw/cuda")) }],
      isDone: false,
      continueCursor: "convex-page-2",
    }));
    const search = new URLSearchParams({ limit: "1" });
    for (const publisherId of publisherIds) search.append("publisherId", publisherId);

    const response = await signedCatalogFeedQueryHandler(
      { runAction, runQuery } as never,
      new Request(`https://clawhub.ai/api/v1/feeds/plugins/query?${search}`),
      await signingEnv(),
    );

    expect(response.status).toBe(200);
    const payload = await signedPayload(response);
    expect(String(payload.nextCursor).length).toBeLessThanOrEqual(4096);
  });

  it("fails closed before materializing when the signer is unavailable", async () => {
    const runAction = vi.fn();
    const runQuery = vi.fn();
    const response = await signedCatalogFeedQueryHandler(
      { runAction, runQuery } as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins/query?q=cuda"),
      {},
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(runAction).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
  });
});
