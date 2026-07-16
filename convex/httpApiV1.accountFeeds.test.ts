/* @vitest-environment node */

import { generateKeyPairSync } from "node:crypto";
import type { RateLimitArgs, RateLimitReturns } from "@convex-dev/rate-limiter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { publishersGetRouterV1Handler } from "./httpApiV1/accountFeedsV1";
import {
  PUBLISHER_FEED_CHANGES_PAYLOAD_TYPE,
  PUBLISHER_FEED_QUERY_PAYLOAD_TYPE,
} from "./httpApiV1/publisherFeedSigning";

type ActionCtx = import("./_generated/server").ActionCtx;

function isRateLimitArgs(args: unknown): args is RateLimitArgs {
  if (!args || typeof args !== "object") return false;
  const value = args as Record<string, unknown>;
  return typeof value.name === "string" && "config" in value;
}

const okRate = (): RateLimitReturns => ({ ok: true });

function signingEnv() {
  const { privateKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    CLAWHUB_FEED_SIGNING_CONFIG: JSON.stringify({
      keyId: "clawhub-feed-2026-q3",
      privateKey,
    }),
  };
}

async function signedPayload<T>(response: Response, payloadType: string) {
  const envelope = (await response.json()) as {
    payloadType: string;
    payload: string;
    signatures: Array<{ keyId: string }>;
  };
  expect(envelope.payloadType).toBe(payloadType);
  expect(envelope.signatures).toMatchObject([{ keyId: "clawhub-feed-2026-q3" }]);
  return JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8")) as T;
}

function makeCtx(partial: Record<string, unknown>) {
  const partialRunQuery =
    typeof partial.runQuery === "function"
      ? (partial.runQuery as (query: unknown, args: Record<string, unknown>) => unknown)
      : null;
  const runQuery = vi.fn(async (query: unknown, args: Record<string, unknown>) =>
    partialRunQuery ? await partialRunQuery(query, args) : null,
  );
  const runMutation =
    typeof partial.runMutation === "function"
      ? partial.runMutation
      : vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
          if (isRateLimitArgs(args)) return okRate();
          return null;
        });

  return { ...partial, runQuery, runMutation } as unknown as ActionCtx;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publisher feed HTTP routes", () => {
  it("serves public publisher detail", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      expect(args).toEqual({ publisherId: "publishers:alice" });
      return {
        publisher: { _id: "publishers:alice", handle: "alice" },
        feedUrl: "/api/v1/publishers/publishers%3Aalice/feed",
      };
    });

    const response = await publishersGetRouterV1Handler(
      makeCtx({ runQuery }),
      new Request("https://example.com/api/v1/publishers/publishers%3Aalice"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      publisher: { _id: "publishers:alice", handle: "alice" },
      feedUrl: "/api/v1/publishers/publishers%3Aalice/feed",
    });
    expect(runQuery).toHaveBeenCalledWith(
      (internal as unknown as { accountFeeds: { getPublisherDetail: unknown } }).accountFeeds
        .getPublisherDetail,
      { publisherId: "publishers:alice" },
    );
  });

  it("serves coherent publisher feed pages with opaque continuation", async () => {
    const entries = [
      { kind: "skill", id: "skills:2", displayName: "Two" },
      { kind: "skill", id: "skills:1", displayName: "One" },
    ];
    const storedFeed = {
      feedId: "clawhub.publisher.publishers:alice",
      publisherId: "publishers:alice",
      handle: "alice",
      displayName: "Alice",
      generatedAt: "2026-07-16T00:00:00.000Z",
      sequence: 7,
      entries,
    };
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return storedFeed;
    });

    const response = await publishersGetRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/publishers/publishers%3Aalice/feed?limit=1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const first = (await response.json()) as {
      sequence: number;
      entries: Array<{ id: string }>;
      nextCursor: string;
    };
    expect(first).toMatchObject({ sequence: 7, entries: [{ id: "skills:2" }] });
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/u);

    const continuationQuery = vi.fn(async () => storedFeed);
    const next = await publishersGetRouterV1Handler(
      makeCtx({ runQuery: continuationQuery }),
      new Request(
        `https://example.com/api/v1/publishers/publishers%3Aalice/feed?limit=1&cursor=${first.nextCursor}`,
      ),
    );
    expect(next.status).toBe(200);
    expect(next.headers.get("cache-control")).toBe("private, no-store");
    expect(await next.json()).toMatchObject({
      sequence: 7,
      entries: [{ id: "skills:1" }],
      nextCursor: null,
    });
  });

  it("rejects malformed cursors and limits", async () => {
    const ctx = makeCtx({});
    const cursorResponse = await publishersGetRouterV1Handler(
      ctx,
      new Request("https://example.com/api/v1/publishers/publishers%3Aalice/feed?cursor=next"),
    );
    expect(cursorResponse.status).toBe(400);
    expect(await cursorResponse.text()).toBe("Invalid publisher feed cursor");

    const limitResponse = await publishersGetRouterV1Handler(
      ctx,
      new Request("https://example.com/api/v1/publishers/publishers%3Aalice/feed?limit=10items"),
    );
    expect(limitResponse.status).toBe(400);
    expect(await limitResponse.text()).toBe("Invalid feed limit");
  });

  it("rejects cursor offsets outside the stored revision", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ publisherId: "publishers:alice", sequence: 7, offset: 2 }),
    ).toString("base64url");
    const publication = {
      publisherId: "publishers:alice",
      feedId: "clawhub.publisher.publishers:alice",
      sequence: 7,
      generatedAt: "2026-07-16T00:00:00.000Z",
      handle: "alice",
      displayName: "Alice",
      entries: [{ id: "skills:one" }],
    };
    const response = await publishersGetRouterV1Handler(
      makeCtx({ runQuery: vi.fn(async () => publication) }),
      new Request(`https://example.com/api/v1/publishers/publishers%3Aalice/feed?cursor=${cursor}`),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid publisher feed cursor offset");
  });

  it("maps missing and malformed publisher feeds to 404", async () => {
    const missing = await publishersGetRouterV1Handler(
      makeCtx({}),
      new Request("https://example.com/api/v1/publishers/publishers%3Amissing/feed"),
    );
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Publisher feed not found");

    const malformed = await publishersGetRouterV1Handler(
      makeCtx({}),
      new Request("https://example.com/api/v1/publishers/%/feed"),
    );
    expect(malformed.status).toBe(404);
    expect(await malformed.text()).toBe("Not found");
  });

  it("serves signed publisher query pages with revision-bound continuations", async () => {
    const entry = {
      kind: "skill",
      id: "skills:cuda",
      name: "cuda-helper",
      displayName: "CUDA Helper",
      summary: "GPU tools",
      url: "/alice/skills/cuda-helper",
      updatedAt: 2,
    };
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        publisherId: "publishers:alice",
        feedId: "clawhub.publisher.publishers:alice",
        sequence: 7,
        generatedAt: "2026-07-16T00:00:00.000Z",
        handle: "alice",
        displayName: "Alice",
        entries: [entry],
      };
    });
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => ({
      feedId: "clawhub.publisher.publishers:alice",
      sequence: 7,
      query: args.query,
      startIndex: args.offset,
      resultCount: 2,
      entries: [entry],
      nextOffset: args.offset === 0 ? 1 : null,
    }));
    const env = signingEnv();
    const first = await publishersGetRouterV1Handler(
      makeCtx({ runMutation, runQuery }),
      new Request(
        "https://clawhub.ai/api/v1/publishers/publishers%3Aalice/feed/query?q=%20CUDA%09Helper%20&kind=skill&limit=1",
      ),
      env,
    );

    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toContain("application/vnd.dsse+json");
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    const page = await signedPayload<{
      sequence: number;
      query: { text: string; kinds: string[] };
      requestCursor: null;
      pageIndex: number;
      nextCursor: string;
    }>(first, PUBLISHER_FEED_QUERY_PAYLOAD_TYPE);
    expect(page).toMatchObject({
      sequence: 7,
      query: { text: "CUDA Helper", kinds: ["skill"] },
      requestCursor: null,
      pageIndex: 0,
    });
    runMutation.mockClear();

    const next = await publishersGetRouterV1Handler(
      makeCtx({ runQuery }),
      new Request(
        `https://clawhub.ai/api/v1/publishers/publishers%3Aalice/feed/query?cursor=${page.nextCursor}`,
      ),
      env,
    );
    expect(next.status).toBe(200);
    const nextPage = await signedPayload<{
      requestCursor: string;
      pageIndex: number;
      startIndex: number;
      nextCursor: null;
    }>(next, PUBLISHER_FEED_QUERY_PAYLOAD_TYPE);
    expect(nextPage).toMatchObject({
      requestCursor: page.nextCursor,
      pageIndex: 1,
      startIndex: 1,
      nextCursor: null,
    });
    expect(runMutation).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ publisherId: "publishers:alice" }),
    );
  });

  it("rejects tampered and stale publisher query cursors", async () => {
    const env = signingEnv();
    const projection = {
      feedId: "clawhub.publisher.publishers:alice",
      sequence: 7,
      query: { text: "CUDA" },
      startIndex: 0,
      resultCount: 2,
      entries: [],
      nextOffset: 1,
    };
    const initial = await publishersGetRouterV1Handler(
      makeCtx({
        runMutation: vi.fn(async (_mutation: unknown, args: Record<string, unknown>) =>
          isRateLimitArgs(args)
            ? okRate()
            : {
                publisherId: "publishers:alice",
                feedId: projection.feedId,
                sequence: 7,
                generatedAt: "2026-07-16T00:00:00.000Z",
                handle: "alice",
                displayName: "Alice",
                entries: [],
              },
        ),
        runQuery: vi.fn(async () => projection),
      }),
      new Request(
        "https://clawhub.ai/api/v1/publishers/publishers%3Aalice/feed/query?q=CUDA&limit=1",
      ),
      env,
    );
    const page = await signedPayload<{ nextCursor: string }>(
      initial,
      PUBLISHER_FEED_QUERY_PAYLOAD_TYPE,
    );
    const replacement = page.nextCursor.endsWith("A") ? "B" : "A";
    const tamperedCursor = page.nextCursor.slice(0, -1) + replacement;
    const tamperedQuery = vi.fn();
    const tampered = await publishersGetRouterV1Handler(
      makeCtx({ runQuery: tamperedQuery }),
      new Request(
        `https://clawhub.ai/api/v1/publishers/publishers%3Aalice/feed/query?cursor=${tamperedCursor}`,
      ),
      env,
    );
    expect(tampered.status).toBe(400);
    expect(tamperedQuery).not.toHaveBeenCalled();

    const stale = await publishersGetRouterV1Handler(
      makeCtx({ runQuery: vi.fn(async () => ({ ...projection, sequence: 8 })) }),
      new Request(
        `https://clawhub.ai/api/v1/publishers/publishers%3Aalice/feed/query?cursor=${page.nextCursor}`,
      ),
      env,
    );
    expect(stale.status).toBe(409);
    expect(await stale.text()).toBe("Publisher query cursor is stale");
  });

  it("serves signed publisher changes and signed reset instructions", async () => {
    const env = signingEnv();
    const change = {
      sequence: 8,
      operation: "remove",
      entryId: "skills:old",
      entryKind: "skill",
    };
    const refresh = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) =>
      isRateLimitArgs(args)
        ? okRate()
        : {
            publisherId: "publishers:alice",
            feedId: "clawhub.publisher.publishers:alice",
            sequence: 8,
            generatedAt: "2026-07-16T00:00:00.000Z",
            handle: "alice",
            displayName: "Alice",
            entries: [],
          },
    );
    const changes = await publishersGetRouterV1Handler(
      makeCtx({
        runMutation: refresh,
        runQuery: vi.fn(async () => ({
          status: "complete",
          feedId: "clawhub.publisher.publishers:alice",
          fromSequence: 7,
          toSequence: 8,
          startIndex: 0,
          changeCount: 1,
          changes: [change],
          nextOffset: null,
        })),
      }),
      new Request(
        "https://clawhub.ai/api/v1/publishers/publishers%3Aalice/feed/changes?fromSequence=7",
      ),
      env,
    );
    expect(changes.status).toBe(200);
    expect(await signedPayload(changes, PUBLISHER_FEED_CHANGES_PAYLOAD_TYPE)).toMatchObject({
      fromSequence: 7,
      toSequence: 8,
      changes: [change],
    });

    const reset = await publishersGetRouterV1Handler(
      makeCtx({
        runMutation: refresh,
        runQuery: vi.fn(async () => ({
          status: "reset-required",
          feedId: "clawhub.publisher.publishers:alice",
          fromSequence: 1,
          currentSequence: 8,
        })),
      }),
      new Request(
        "https://clawhub.ai/api/v1/publishers/publishers%3Aalice/feed/changes?fromSequence=1",
      ),
      env,
    );
    expect(reset.status).toBe(409);
    expect(await signedPayload(reset, PUBLISHER_FEED_CHANGES_PAYLOAD_TYPE)).toMatchObject({
      resetRequired: true,
      snapshotUrl: "https://clawhub.ai/api/v1/publishers/publishers%3Aalice/feed",
    });
  });

  it.each([{}, { CLAWHUB_FEED_SIGNING_CONFIG: "not-json" }])(
    "fails signed projections closed before publisher storage reads",
    async (env) => {
      const runQuery = vi.fn();
      const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) =>
        isRateLimitArgs(args) ? okRate() : null,
      );
      const response = await publishersGetRouterV1Handler(
        makeCtx({ runQuery, runMutation }),
        new Request("https://clawhub.ai/api/v1/publishers/publishers%3Aalice/feed/query?q=CUDA"),
        env,
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(runQuery).not.toHaveBeenCalled();
      expect(runMutation).toHaveBeenCalled();
      expect(runMutation).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ publisherId: "publishers:alice" }),
      );
    },
  );
});
