import { describe, expect, it, vi } from "vitest";
import {
  BLOCKED_API_TOKEN_ACCOUNT_MESSAGE,
  INVALID_API_TOKEN_MESSAGE,
  MISSING_API_TOKEN_MESSAGE,
  getOptionalApiTokenUserId,
  requireApiTokenUser,
} from "./apiTokenAuth";
import { hashToken } from "./tokens";

describe("getOptionalApiTokenUserId", () => {
  it("returns null when auth header is missing", async () => {
    const ctx = {
      runQuery: vi.fn(),
    };
    const request = new Request("https://example.com");

    const userId = await getOptionalApiTokenUserId(ctx as never, request);

    expect(userId).toBeNull();
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it("returns null for unknown token", async () => {
    const ctx = {
      runQuery: vi.fn().mockResolvedValue(null),
    };
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer token-1" },
    });

    const userId = await getOptionalApiTokenUserId(ctx as never, request);

    expect(userId).toBeNull();
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
    expect(ctx.runQuery.mock.calls[0]?.[1]).toEqual({
      tokenHash: await hashToken("token-1"),
    });
  });

  it("returns user id when token and user are valid", async () => {
    const tokenId = "apiTokens_1";
    const expectedUserId = "users_1";
    const ctx = {
      runQuery: vi
        .fn()
        .mockImplementation(async (_fn, args: { tokenHash?: string; tokenId?: string }) => {
          if (args.tokenHash) {
            return { _id: tokenId, revokedAt: undefined };
          }
          if (args.tokenId) {
            return { _id: expectedUserId, deletedAt: undefined };
          }
          return null;
        }),
    };
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer token-2" },
    });

    const userId = await getOptionalApiTokenUserId(ctx as never, request);

    expect(userId).toBe(expectedUserId);
    expect(ctx.runQuery).toHaveBeenCalledTimes(2);
  });

  it("returns null when user is deleted", async () => {
    const tokenId = "apiTokens_2";
    const ctx = {
      runQuery: vi
        .fn()
        .mockImplementation(async (_fn, args: { tokenHash?: string; tokenId?: string }) => {
          if (args.tokenHash) {
            return { _id: tokenId, revokedAt: undefined };
          }
          if (args.tokenId) {
            return { _id: "users_deleted", deletedAt: Date.now() };
          }
          return null;
        }),
    };
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer token-3" },
    });

    const userId = await getOptionalApiTokenUserId(ctx as never, request);

    expect(userId).toBeNull();
    expect(ctx.runQuery).toHaveBeenCalledTimes(2);
  });

  it("returns null when user is deactivated", async () => {
    const tokenId = "apiTokens_3";
    const ctx = {
      runQuery: vi
        .fn()
        .mockImplementation(async (_fn, args: { tokenHash?: string; tokenId?: string }) => {
          if (args.tokenHash) {
            return { _id: tokenId, revokedAt: undefined };
          }
          if (args.tokenId) {
            return { _id: "users_deactivated", deactivatedAt: Date.now() };
          }
          return null;
        }),
    };
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer token-4" },
    });

    const userId = await getOptionalApiTokenUserId(ctx as never, request);

    expect(userId).toBeNull();
    expect(ctx.runQuery).toHaveBeenCalledTimes(2);
  });
});

describe("requireApiTokenUser", () => {
  it("explains missing tokens", async () => {
    const ctx = { runQuery: vi.fn(), runMutation: vi.fn() };

    await expect(
      requireApiTokenUser(ctx as never, new Request("https://example.com")),
    ).rejects.toThrow(MISSING_API_TOKEN_MESSAGE);
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it("explains invalid or revoked tokens", async () => {
    const ctx = { runQuery: vi.fn().mockResolvedValue(null), runMutation: vi.fn() };

    await expect(
      requireApiTokenUser(
        ctx as never,
        new Request("https://example.com", { headers: { authorization: "Bearer token-5" } }),
      ),
    ).rejects.toThrow(INVALID_API_TOKEN_MESSAGE);
  });

  it("explains tokens whose account is not in good standing", async () => {
    const ctx = {
      runQuery: vi
        .fn()
        .mockImplementation(async (_fn, args: { tokenHash?: string; tokenId?: string }) => {
          if (args.tokenHash) return { _id: "apiTokens_4", revokedAt: undefined };
          if (args.tokenId) return { _id: "users_blocked", deletedAt: Date.now() };
          return null;
        }),
      runMutation: vi.fn(),
    };

    await expect(
      requireApiTokenUser(
        ctx as never,
        new Request("https://example.com", { headers: { authorization: "Bearer token-6" } }),
      ),
    ).rejects.toThrow(BLOCKED_API_TOKEN_ACCOUNT_MESSAGE);
  });
});
