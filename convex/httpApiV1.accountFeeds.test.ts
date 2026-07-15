/* @vitest-environment node */
import type { RateLimitArgs, RateLimitReturns } from "@convex-dev/rate-limiter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import {
  accountsGetRouterV1Handler,
  publishersGetRouterV1Handler,
} from "./httpApiV1/accountFeedsV1";

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
          return okRate();
        });

  return { ...partial, runQuery, runMutation } as unknown as ActionCtx;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("account feed HTTP routes", () => {
  it("serves public account detail", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      expect(args).toEqual({ accountId: "users:alice" });
      return {
        account: { _id: "users:alice", handle: "alice" },
        publisher: { _id: "publishers:alice", handle: "alice" },
        feedUrl: "/api/v1/accounts/users%3Aalice/feed",
      };
    });

    const response = await accountsGetRouterV1Handler(
      makeCtx({ runQuery }),
      new Request("https://example.com/api/v1/accounts/users%3Aalice"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      account: { _id: "users:alice", handle: "alice" },
      feedUrl: "/api/v1/accounts/users%3Aalice/feed",
    });
    expect(runQuery).toHaveBeenCalledWith(
      (internal as unknown as { accountFeeds: { getAccountDetail: unknown } }).accountFeeds
        .getAccountDetail,
      { accountId: "users:alice" },
    );
  });

  it("serves bounded account feeds with public cache headers", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      expect(args).toEqual({ accountId: "users:alice", limit: 100 });
      return {
        schemaVersion: 1,
        feedId: "clawhub.account.users:alice",
        scope: "account",
        accountId: "users:alice",
        publisherId: "publishers:alice",
        handle: "alice",
        displayName: "Alice",
        generatedAt: "2026-07-02T00:00:00.000Z",
        sequence: 0,
        entries: [],
        nextCursor: null,
      };
    });

    const response = await accountsGetRouterV1Handler(
      makeCtx({ runQuery }),
      new Request("https://example.com/api/v1/accounts/users%3Aalice/feed?limit=500"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(await response.json()).not.toHaveProperty("official");
  });

  it("rejects unsupported cursors and malformed limits", async () => {
    const ctx = makeCtx({});
    const cursorResponse = await accountsGetRouterV1Handler(
      ctx,
      new Request("https://example.com/api/v1/accounts/users%3Aalice/feed?cursor=next"),
    );
    expect(cursorResponse.status).toBe(400);
    expect(await cursorResponse.text()).toBe("Cursor pagination is not available");

    const limitResponse = await accountsGetRouterV1Handler(
      ctx,
      new Request("https://example.com/api/v1/accounts/users%3Aalice/feed?limit=10items"),
    );
    expect(limitResponse.status).toBe(400);
    expect(await limitResponse.text()).toBe("Invalid feed limit");
  });

  it("does not double-decode account path ids", async () => {
    const response = await accountsGetRouterV1Handler(
      makeCtx({}),
      new Request("https://example.com/api/v1/accounts/foo%25"),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Account not found");
  });

  it("maps malformed account path escapes to 404", async () => {
    const response = await accountsGetRouterV1Handler(
      makeCtx({}),
      new Request("https://example.com/api/v1/accounts/%"),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  it("maps missing publisher feeds to 404", async () => {
    const response = await publishersGetRouterV1Handler(
      makeCtx({}),
      new Request("https://example.com/api/v1/publishers/publishers%3Amissing/feed"),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Publisher feed not found");
  });

  it("maps malformed publisher path escapes to 404", async () => {
    const response = await publishersGetRouterV1Handler(
      makeCtx({}),
      new Request("https://example.com/api/v1/publishers/%/feed"),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });
});
