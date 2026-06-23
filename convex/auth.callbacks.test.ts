import { describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";

const { convexAuthMock } = vi.hoisted(() => ({
  convexAuthMock: vi.fn(() => ({
    auth: {},
    signIn: {},
    signOut: {},
    store: {},
    isAuthenticated: {},
  })),
}));

vi.mock("@convex-dev/auth/server", async () => {
  const actual =
    await vi.importActual<typeof import("@convex-dev/auth/server")>("@convex-dev/auth/server");
  return {
    ...actual,
    convexAuth: convexAuthMock,
  };
});

type CapturedAuthConfig = {
  callbacks?: {
    createOrUpdateUser?: (
      ctx: unknown,
      args: {
        existingUserId: Id<"users"> | null;
        provider: { type: string; allowDangerousEmailAccountLinking?: boolean };
        profile: Record<string, unknown> & {
          email?: string;
          phone?: string;
          emailVerified?: boolean;
          phoneVerified?: boolean;
        };
      },
    ) => Promise<Id<"users">>;
    beforeSessionCreation?: (ctx: unknown, args: { userId: Id<"users"> }) => Promise<void> | void;
  };
};

function getCapturedAuthConfig() {
  const calls = convexAuthMock.mock.calls as unknown as Array<[CapturedAuthConfig]>;
  const config = calls[0]?.[0];
  if (!config) throw new Error("convexAuth was not called");
  return config;
}

function makeAuthCtx(user: { _id: Id<"users">; deletedAt?: number; deactivatedAt?: number }) {
  const userId = user._id;
  const collect = vi.fn().mockResolvedValue([{ action: "user.ban" }]);
  const ctx = {
    db: {
      get: vi.fn().mockResolvedValue(user),
      patch: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockResolvedValue(userId),
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({ collect }),
      }),
    },
    scheduler: {
      runAfter: vi.fn().mockResolvedValue(null),
    },
  };
  return { ctx, userId };
}

describe("auth callbacks", () => {
  it("defers banned account rejection until session creation", async () => {
    await import("./auth");
    const config = getCapturedAuthConfig();
    const { ctx, userId } = makeAuthCtx({ _id: "users:banned" as Id<"users">, deletedAt: 123 });

    await expect(
      config.callbacks?.createOrUpdateUser?.(ctx, {
        existingUserId: userId,
        provider: { type: "oauth", allowDangerousEmailAccountLinking: false },
        profile: {
          id: "123",
          name: "renamed-banned-user",
          email: "banned@example.com",
          image: "https://example.com/avatar.png",
        },
      }),
    ).resolves.toBe(userId);

    await expect(config.callbacks?.beforeSessionCreation?.(ctx, { userId })).rejects.toThrow(
      /account has been banned/i,
    );

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it("updates active existing users and schedules post-update side effects", async () => {
    await import("./auth");
    const config = getCapturedAuthConfig();
    const { ctx, userId } = makeAuthCtx({ _id: "users:active" as Id<"users"> });

    await expect(
      config.callbacks?.createOrUpdateUser?.(ctx, {
        existingUserId: userId,
        provider: { type: "oauth", allowDangerousEmailAccountLinking: false },
        profile: {
          id: "123",
          name: "active-user",
          email: "active@example.com",
          image: "https://example.com/avatar.png",
        },
      }),
    ).resolves.toBe(userId);

    expect(ctx.db.patch).toHaveBeenCalledWith(userId, {
      id: "123",
      name: "active-user",
      email: "active@example.com",
      image: "https://example.com/avatar.png",
    });
    expect(ctx.scheduler.runAfter).toHaveBeenCalled();
  });
});
