import { describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import {
  BANNED_REAUTH_MESSAGE,
  DELETED_ACCOUNT_REAUTH_MESSAGE,
  createGitHubAuthProvider,
  handleDeletedUserSignIn,
  normalizeGitHubProfileId,
} from "./auth";

function makeCtx({
  user,
  banRecords,
}: {
  user: {
    deletedAt?: number;
    deactivatedAt?: number;
    purgedAt?: number;
    banReason?: string;
  } | null;
  banRecords?: Array<Record<string, unknown>>;
}) {
  const query = {
    withIndex: vi.fn().mockReturnValue({
      collect: vi.fn().mockResolvedValue(banRecords ?? []),
    }),
  };
  const ctx = {
    db: {
      get: vi.fn().mockResolvedValue(user),
      patch: vi.fn().mockResolvedValue(null),
      query: vi.fn().mockReturnValue(query),
    },
  };
  return { ctx, query };
}

describe("handleDeletedUserSignIn", () => {
  const userId = "users:1" as Id<"users">;

  it("skips when user not found", async () => {
    const { ctx } = makeCtx({ user: null });

    await handleDeletedUserSignIn(ctx as never, { userId, existingUserId: userId });

    expect(ctx.db.get).toHaveBeenCalledWith(userId);
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("skips active users", async () => {
    const { ctx } = makeCtx({ user: { deletedAt: undefined, deactivatedAt: undefined } });

    await handleDeletedUserSignIn(ctx as never, { userId, existingUserId: userId });

    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("blocks sign-in for deactivated users", async () => {
    const { ctx } = makeCtx({ user: { deactivatedAt: 123, purgedAt: 123 } });

    await expect(
      handleDeletedUserSignIn(ctx as never, { userId, existingUserId: userId }),
    ).rejects.toThrow(DELETED_ACCOUNT_REAUTH_MESSAGE);

    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("migrates legacy self-deleted users and blocks sign-in", async () => {
    const { ctx } = makeCtx({ user: { deletedAt: 123 }, banRecords: [] });

    await expect(
      handleDeletedUserSignIn(ctx as never, { userId, existingUserId: userId }),
    ).rejects.toThrow(DELETED_ACCOUNT_REAUTH_MESSAGE);

    expect(ctx.db.patch).toHaveBeenCalledWith(userId, {
      deletedAt: undefined,
      deactivatedAt: 123,
      purgedAt: 123,
      updatedAt: expect.any(Number),
    });
  });

  it("migrates legacy users on fresh login (existingUserId is null)", async () => {
    const { ctx } = makeCtx({ user: { deletedAt: 123 }, banRecords: [] });

    await expect(
      handleDeletedUserSignIn(ctx as never, { userId, existingUserId: null }),
    ).rejects.toThrow(DELETED_ACCOUNT_REAUTH_MESSAGE);

    expect(ctx.db.patch).toHaveBeenCalledWith(userId, {
      deletedAt: undefined,
      deactivatedAt: 123,
      purgedAt: 123,
      updatedAt: expect.any(Number),
    });
  });

  it("skips mutation when existingUserId does not match userId", async () => {
    const otherUserId = "users:999" as Id<"users">;
    const { ctx } = makeCtx({ user: { deletedAt: 123 } });

    await handleDeletedUserSignIn(ctx as never, { userId, existingUserId: otherUserId });

    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("blocks banned users with a custom message", async () => {
    const { ctx } = makeCtx({ user: { deletedAt: 123 }, banRecords: [{ action: "user.ban" }] });

    await expect(
      handleDeletedUserSignIn(ctx as never, { userId, existingUserId: userId }),
    ).rejects.toThrow(BANNED_REAUTH_MESSAGE);

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("blocks users auto-banned for malware", async () => {
    const { ctx } = makeCtx({
      user: { deletedAt: 123, banReason: "malware auto-ban" },
      banRecords: [{ action: "user.autoban.malware" }],
    });

    await expect(
      handleDeletedUserSignIn(ctx as never, { userId, existingUserId: userId }),
    ).rejects.toThrow(BANNED_REAUTH_MESSAGE);

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("blocks users auto-banned for publisher abuse", async () => {
    const { ctx } = makeCtx({
      user: { deletedAt: 123, banReason: "publisher_abuse: potential ban candidate" },
      banRecords: [{ action: "user.autoban.publisher_abuse" }],
    });

    await expect(
      handleDeletedUserSignIn(ctx as never, { userId, existingUserId: userId }),
    ).rejects.toThrow(BANNED_REAUTH_MESSAGE);

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("does not leak the moderator ban reason in the sign-in error", async () => {
    const { ctx } = makeCtx({
      user: { deletedAt: 123, banReason: "Chargeback fraud" },
      banRecords: [{ action: "user.ban" }],
    });

    await expect(
      handleDeletedUserSignIn(ctx as never, { userId, existingUserId: userId }),
    ).rejects.toThrow(BANNED_REAUTH_MESSAGE);
  });
});

describe("GitHub auth provider", () => {
  it("requests read-only GitHub organization membership access", () => {
    const provider = createGitHubAuthProvider() as {
      options?: { authorization?: { params?: { scope?: string } } };
    };

    expect(provider.options?.authorization?.params?.scope?.split(" ")).toContain("read:org");
  });

  it("does not link ClawHub accounts by GitHub profile email", () => {
    const provider = createGitHubAuthProvider() as {
      options?: { allowDangerousEmailAccountLinking?: boolean };
    };

    expect(provider.options?.allowDangerousEmailAccountLinking).toBe(false);
  });

  it("normalizes numeric GitHub profile ids", () => {
    expect(normalizeGitHubProfileId(123456)).toBe("123456");
    expect(normalizeGitHubProfileId("789012")).toBe("789012");
  });

  it("rejects missing or nonnumeric GitHub profile ids", () => {
    expect(() => normalizeGitHubProfileId(undefined)).toThrow(
      "GitHub OAuth profile is missing a valid numeric id",
    );
    expect(() => normalizeGitHubProfileId("undefined")).toThrow(
      "GitHub OAuth profile is missing a valid numeric id",
    );
    expect(() => normalizeGitHubProfileId("github-user")).toThrow(
      "GitHub OAuth profile is missing a valid numeric id",
    );
  });

  it("fails closed when the GitHub provider receives a malformed profile", async () => {
    const provider = createGitHubAuthProvider() as {
      options?: {
        profile?: (
          profile: Record<string, unknown>,
          tokens: { access_token?: string },
        ) => Promise<Record<string, unknown>>;
      };
    };

    await expect(provider.options?.profile?.({ message: "Bad credentials" }, {})).rejects.toThrow(
      "GitHub OAuth profile is missing a valid numeric id",
    );
    await expect(
      provider.options?.profile?.({ id: 123456, login: "fixture-user" }, {}),
    ).resolves.toEqual({
      id: "123456",
      name: "fixture-user",
      email: undefined,
      image: undefined,
    });
  });

  it("adds a verified GitHub organization snapshot to the OAuth profile", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            state: "active",
            role: "member",
            organization: { id: 42, login: "trycua" },
          },
        ]),
        { status: 200 },
      ),
    );
    const provider = createGitHubAuthProvider() as {
      options?: {
        profile?: (
          profile: Record<string, unknown>,
          tokens: { access_token?: string },
        ) => Promise<Record<string, unknown>>;
      };
    };

    await expect(
      provider.options?.profile?.(
        { id: 123456, login: "fixture-user" },
        { access_token: "test-token-placeholder" },
      ),
    ).resolves.toEqual({
      id: "123456",
      name: "fixture-user",
      email: undefined,
      image: undefined,
      githubOrgMembershipSync: {
        memberships: [
          {
            githubOrgId: "42",
            login: "trycua",
            avatarUrl: undefined,
            role: "member",
          },
        ],
        syncedAt: expect.any(Number),
        truncated: false,
      },
    });
    fetchMock.mockRestore();
  });
});
