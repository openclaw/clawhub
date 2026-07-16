/* @vitest-environment node */
import type { RateLimitArgs, RateLimitReturns } from "@convex-dev/rate-limiter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { publishersGetRouterV1Handler } from "./httpApiV1/accountFeedsV1";

type ActionCtx = import("./_generated/server").ActionCtx;

function isRateLimitArgs(args: unknown): args is RateLimitArgs {
  if (!args || typeof args !== "object") return false;
  const value = args as Record<string, unknown>;
  return typeof value.name === "string" && "config" in value;
}

const okRate = (): RateLimitReturns => ({ ok: true });

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
});
