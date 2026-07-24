import { createPublicKey, generateKeyPairSync, verify as verifyDetached } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import {
  OPENCLAW_CATALOG_FEED_PAYLOAD_TYPE,
  negotiatedCatalogFeedV1Handler,
  resolveFeedSigningConfig,
  signCatalogFeedPayload,
  signedCatalogFeedV1Handler,
} from "./httpApiV1/catalogFeedSigning";

type QueryCtx = {
  runQuery: ReturnType<typeof vi.fn>;
};

const publication = {
  feedId: "clawhub-official",
  sequence: 4,
  generatedAt: "2026-06-23T00:00:00.000Z",
  expiresAt: "2026-06-30T00:00:00.000Z",
  payload:
    '{"schemaVersion":1,"id":"clawhub-official","generatedAt":"2026-06-23T00:00:00.000Z","sequence":4,"expiresAt":"2026-06-30T00:00:00.000Z","entries":[]}',
  payloadSha256: "catalog-payload-sha256",
  publishedAt: Date.parse("2026-06-23T00:00:00.000Z"),
};

async function signingFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const env = {
    CLAWHUB_FEED_SIGNING_CONFIG: JSON.stringify({
      keyId: "clawhub-feed-2026-q3",
      privateKey,
    }),
  };
  const config = await resolveFeedSigningConfig(env);
  if (!config) throw new Error("expected signing config");
  return { config, env, publicKey };
}

function dsseInput(payloadBytes: Buffer) {
  const typeBytes = Buffer.from(OPENCLAW_CATALOG_FEED_PAYLOAD_TYPE, "utf8");
  return Buffer.concat([
    Buffer.from(
      `DSSEv1 ${typeBytes.length} ${OPENCLAW_CATALOG_FEED_PAYLOAD_TYPE} ${payloadBytes.length} `,
      "utf8",
    ),
    payloadBytes,
  ]);
}

describe("signed catalog feed", () => {
  let ctx: QueryCtx;

  beforeEach(() => {
    ctx = { runQuery: vi.fn().mockResolvedValue(publication) };
  });

  it("preserves the unsigned representation unless a client opts into DSSE", async () => {
    const unsigned = await negotiatedCatalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins"),
      {},
    );

    expect(unsigned.status).toBe(200);
    expect(unsigned.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(unsigned.headers.get("vary")).toContain("Accept");
    expect(await unsigned.text()).toBe(publication.payload);

    const { env } = await signingFixture();
    const signed = await negotiatedCatalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins", {
        headers: { Accept: "application/vnd.dsse+json" },
      }),
      env,
    );

    expect(signed.status).toBe(200);
    expect(signed.headers.get("content-type")).toBe("application/vnd.dsse+json; charset=utf-8");
    expect(signed.headers.get("vary")).toContain("Accept");
  });

  it("contains signing failures to clients that request the signed representation", async () => {
    const unsigned = await negotiatedCatalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins"),
      {},
    );
    const signed = await negotiatedCatalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins", {
        headers: { Accept: "application/vnd.dsse+json" },
      }),
      {},
    );

    expect(unsigned.status).toBe(200);
    expect(signed.status).toBe(503);
    expect(signed.headers.get("cache-control")).toBe("no-store");
  });

  it.each([{}, { CLAWHUB_FEED_SIGNING_CONFIG: "not-json" }])(
    "keeps the existing unsigned route available while signing is dormant or invalid",
    async (env) => {
      const response = await negotiatedCatalogFeedV1Handler(
        ctx as never,
        new Request("https://clawhub.ai/api/v1/feeds/plugins"),
        env,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(await response.text()).toBe(publication.payload);
    },
  );

  it("signs the exact stored publication bytes with DSSE Ed25519", async () => {
    const { config, publicKey } = await signingFixture();
    const signed = await signCatalogFeedPayload(publication.payload, config);
    const payloadBytes = Buffer.from(signed.envelope.payload, "base64url");

    expect(payloadBytes.toString("utf8")).toBe(publication.payload);
    expect(Object.keys(signed.envelope).sort()).toEqual(["payload", "payloadType", "signatures"]);
    expect(signed.envelope).toMatchObject({
      payloadType: OPENCLAW_CATALOG_FEED_PAYLOAD_TYPE,
      signatures: [
        {
          keyid: "clawhub-feed-2026-q3",
        },
      ],
    });
    expect(Object.keys(signed.envelope.signatures[0] ?? {}).sort()).toEqual(["keyid", "sig"]);
    expect(
      verifyDetached(
        null,
        dsseInput(payloadBytes),
        createPublicKey(publicKey),
        Buffer.from(signed.envelope.signatures[0]?.sig ?? "", "base64url"),
      ),
    ).toBe(true);
  });

  it("serves a stable signed representation with envelope validators", async () => {
    const { env } = await signingFixture();
    const first = await signedCatalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins"),
      env,
    );

    expect(first.status).toBe(200);
    const body = await first.text();
    const envelope = JSON.parse(body) as { payload: string };
    expect(Buffer.from(envelope.payload, "base64url").toString("utf8")).toBe(publication.payload);
    expect(first.headers.get("content-type")).toBe("application/vnd.dsse+json; charset=utf-8");
    expect(first.headers.get("etag")).toMatch(/^"sha256:[a-f0-9]{64}"$/u);
    expect(first.headers.get("x-content-sha256")).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.headers.get("x-catalog-payload-sha256")).toBe(publication.payloadSha256);
    expect(first.headers.get("x-openclaw-feed-signing-key-id")).toBe("clawhub-feed-2026-q3");
    expect(first.headers.get("last-modified")).toBeNull();
    expect(ctx.runQuery).toHaveBeenCalledWith(internal.catalogFeed.getLatestPublication, {
      feedId: "clawhub-official",
    });

    const etag = first.headers.get("etag") ?? "";
    const notModified = await signedCatalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins", {
        headers: { "If-None-Match": etag },
      }),
      env,
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");

    const repeated = await signedCatalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins"),
      env,
    );
    expect(await repeated.text()).toBe(body);
    expect(repeated.headers.get("etag")).toBe(etag);

    const ignoredLastModified = await signedCatalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins", {
        headers: { "If-Modified-Since": "Wed, 31 Dec 2098 23:59:59 GMT" },
      }),
      env,
    );
    expect(ignoredLastModified.status).toBe(200);
  });

  it("redirects an oversized plugin catalog to its signed shard root", async () => {
    const { env } = await signingFixture();
    ctx.runQuery
      .mockResolvedValueOnce(publication)
      .mockResolvedValueOnce({ feedId: "clawhub-official", sequence: 5 });

    const response = await signedCatalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins"),
      env,
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("/v1/feeds/plugins/root");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    {},
    { CLAWHUB_FEED_SIGNING_CONFIG: "not-json" },
    { CLAWHUB_FEED_SIGNING_CONFIG: "[]" },
    {
      CLAWHUB_FEED_SIGNING_CONFIG: JSON.stringify({
        keyId: "clawhub-feed-2026-q3",
      }),
    },
    {
      CLAWHUB_FEED_SIGNING_CONFIG: JSON.stringify({
        keyId: "clawhub-feed-2026-q3",
        privateKey: "not-a-private-key",
      }),
    },
    {
      CLAWHUB_FEED_SIGNING_CONFIG: JSON.stringify({
        keyId: "invalid key id\r\nheader",
        privateKey: "not-a-private-key",
        unexpected: true,
      }),
    },
  ])("fails closed before reading a publication when signing config is invalid", async (env) => {
    const response = await signedCatalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins"),
      env,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it("does not cache a missing stored publication", async () => {
    const { env } = await signingFixture();
    ctx.runQuery.mockResolvedValue(null);
    const response = await signedCatalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins"),
      env,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
