import { generateKeyPairSync } from "node:crypto";
import { CATALOG_FEED_CHANGES_PAYLOAD_TYPE } from "clawhub-schema";
import { describe, expect, it, vi } from "vitest";
import { signedCatalogFeedChangesHandler } from "./httpApiV1/catalogFeedChanges";

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
  expect(envelope.payloadType).toBe(CATALOG_FEED_CHANGES_PAYLOAD_TYPE);
  return JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

describe("signed catalog feed changes", () => {
  it("pins and signs a paginated change range", async () => {
    const env = await signingEnv();
    const runQuery = vi.fn(async (_reference, args: Record<string, unknown>) => {
      if (!("fromSequence" in args)) {
        return { retainedFromSequence: 3, currentSequence: 5 };
      }
      const pagination = args.paginationOpts as { cursor: string | null };
      return pagination.cursor === null
        ? {
            resetRequired: false,
            retainedFromSequence: 3,
            currentSequence: 5,
            changeCount: 2,
            page: [
              {
                sequence: 4,
                ordinal: 0,
                payload: JSON.stringify({
                  sequence: 4,
                  operation: "metadata",
                  metadata: { description: "Official" },
                }),
              },
            ],
            isDone: false,
            continueCursor: "convex-page-2",
          }
        : {
            resetRequired: false,
            retainedFromSequence: 3,
            currentSequence: 5,
            changeCount: 2,
            page: [
              {
                sequence: 5,
                ordinal: 0,
                payload: JSON.stringify({
                  sequence: 5,
                  operation: "metadata",
                  metadata: { description: "Current" },
                }),
              },
            ],
            isDone: true,
            continueCursor: "",
          };
    });
    const ctx = { runQuery };
    const firstResponse = await signedCatalogFeedChangesHandler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins/changes?fromSequence=3&limit=1"),
      env,
    );

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get("cache-control")).toBe("no-store");
    expect(firstResponse.headers.get("content-type")).toBe(
      "application/vnd.dsse+json; charset=utf-8",
    );
    const first = await signedPayload(firstResponse);
    expect(first).toMatchObject({
      feedId: "clawhub-official",
      fromSequence: 3,
      toSequence: 5,
      requestCursor: null,
      pageIndex: 0,
      startIndex: 0,
      changeCount: 2,
    });
    const nextCursor = String(first.nextCursor);

    const secondResponse = await signedCatalogFeedChangesHandler(
      ctx as never,
      new Request(
        `https://clawhub.ai/api/v1/feeds/plugins/changes?cursor=${encodeURIComponent(nextCursor)}`,
      ),
      env,
    );
    expect(secondResponse.status).toBe(200);
    const second = await signedPayload(secondResponse);
    expect(second).toMatchObject({
      requestCursor: nextCursor,
      pageIndex: 1,
      startIndex: 1,
      changeCount: 2,
      nextCursor: null,
    });
    expect(runQuery.mock.calls.at(-1)?.[1]).toMatchObject({
      fromSequence: 3,
      toSequence: 5,
      paginationOpts: { cursor: "convex-page-2", numItems: 1 },
    });

    runQuery.mockClear();
    const replacement = nextCursor.endsWith("A") ? "B" : "A";
    const tampered = `${nextCursor.slice(0, -1)}${replacement}`;
    const tamperedResponse = await signedCatalogFeedChangesHandler(
      ctx as never,
      new Request(
        `https://clawhub.ai/api/v1/feeds/plugins/changes?cursor=${encodeURIComponent(tampered)}`,
      ),
      env,
    );
    expect(tamperedResponse.status).toBe(400);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("returns a signed reset response when retained history cannot cover the range", async () => {
    const env = await signingEnv();
    const runQuery = vi.fn(async (_reference, args: Record<string, unknown>) =>
      !("fromSequence" in args)
        ? { retainedFromSequence: 3, currentSequence: 5 }
        : { resetRequired: true, retainedFromSequence: 3, currentSequence: 5 },
    );
    const response = await signedCatalogFeedChangesHandler(
      { runQuery } as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins/changes?fromSequence=2"),
      env,
    );

    expect(response.status).toBe(409);
    expect(await signedPayload(response)).toMatchObject({
      fromSequence: 2,
      currentSequence: 5,
      resetRequired: true,
      snapshotUrl: "https://clawhub.ai/api/v1/feeds/plugins",
    });
  });

  it("fails closed before querying when the signer is unavailable", async () => {
    const runQuery = vi.fn();
    const response = await signedCatalogFeedChangesHandler(
      { runQuery } as never,
      new Request("https://clawhub.ai/api/v1/feeds/plugins/changes?fromSequence=0"),
      {},
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(runQuery).not.toHaveBeenCalled();
  });
});
