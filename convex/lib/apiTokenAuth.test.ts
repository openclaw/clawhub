import { describe, expect, it, vi } from "vitest";
import {
  BLOCKED_API_TOKEN_ACCOUNT_MESSAGE,
  INVALID_API_TOKEN_MESSAGE,
  MISSING_API_TOKEN_MESSAGE,
  getOptionalApiTokenUserId,
  getOptionalApiTokenUser,
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

  it("resolves quota and viewer identity with one query per request", async () => {
    const tokenId = "apiTokens_1";
    const expectedUserId = "users_1";
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        apiTokenId: tokenId,
        user: { _id: expectedUserId },
      }),
    };
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer token-2" },
    });

    const userId = await getOptionalApiTokenUserId(ctx as never, request);

    expect(userId).toBe(expectedUserId);
    expect(await getOptionalApiTokenUser(ctx as never, request)).toMatchObject({
      userId: expectedUserId,
    });
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);
  });

  it.each([null, { deletedAt: 1 }, { deactivatedAt: 1 }])(
    "returns null for an inactive account: %j",
    async (account) => {
      const ctx = {
        runQuery: vi.fn().mockResolvedValue({
          apiTokenId: "apiTokens_2",
          user: account ? { _id: "users_inactive", ...account } : null,
        }),
      };
      const request = new Request("https://example.com", {
        headers: { authorization: "Bearer inactive-token" },
      });
      expect(await getOptionalApiTokenUserId(ctx as never, request)).toBeNull();
    },
  );

  it("shares concurrent reads but revalidates new requests and contexts", async () => {
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({ apiTokenId: "token_1", user: { _id: "users_1" } }),
    };
    const request = new Request("https://example.com", {
      headers: { authorization: "Bearer token-2" },
    });
    expect(
      await Promise.all([
        getOptionalApiTokenUserId(ctx as never, request),
        getOptionalApiTokenUserId(ctx as never, request),
      ]),
    ).toEqual(["users_1", "users_1"]);
    expect(ctx.runQuery).toHaveBeenCalledTimes(1);

    ctx.runQuery.mockResolvedValue(null);
    expect(await getOptionalApiTokenUserId(ctx as never, request.clone())).toBeNull();
    expect(await getOptionalApiTokenUserId({ ...ctx } as never, request)).toBeNull();
    expect(ctx.runQuery).toHaveBeenCalledTimes(3);
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
      runQuery: vi.fn().mockResolvedValue({
        apiTokenId: "apiTokens_4",
        user: { _id: "users_blocked", deletedAt: 1 },
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

it("revalidates required authorization after an optional read and keeps touch best effort", async () => {
  const ctx = {
    runQuery: vi.fn().mockResolvedValue({ apiTokenId: "token_1", user: { _id: "users_1" } }),
    runMutation: vi.fn().mockRejectedValue(new Error("write contention")),
  };
  const request = new Request("https://example.com", {
    headers: { authorization: "Bearer token-2" },
  });
  expect(await getOptionalApiTokenUserId(ctx as never, request)).toBe("users_1");
  expect(await requireApiTokenUser(ctx as never, request)).toMatchObject({
    userId: "users_1",
    apiTokenId: "token_1",
  });
  expect(ctx.runQuery).toHaveBeenCalledTimes(2);
  expect(ctx.runMutation).toHaveBeenCalledTimes(1);

  ctx.runQuery.mockResolvedValue(null);
  await expect(requireApiTokenUser(ctx as never, request)).rejects.toThrow(
    INVALID_API_TOKEN_MESSAGE,
  );
  expect(ctx.runMutation).toHaveBeenCalledTimes(1);
});
