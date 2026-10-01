import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");
const { assertAdmin, assertModerator, assertRole, requireUser, requireUserFromAction } =
  await import("./access");

beforeEach(() => {
  vi.mocked(getAuthUserId).mockReset();
});

describe("access.requireUser", () => {
  it("throws when auth is missing", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null);
    await expect(
      requireUser({
        db: { get: vi.fn() },
      } as never),
    ).rejects.toThrow("Unauthorized");
  });

  it("throws when user is deleted/deactivated/missing", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:1" as never);

    for (const value of [
      null,
      { _id: "users:1", deletedAt: Date.now() },
      { _id: "users:1", deactivatedAt: Date.now() },
    ]) {
      const dbGet = vi.fn().mockResolvedValue(value as never);
      await expect(
        requireUser({
          db: { get: dbGet },
        } as never),
      ).rejects.toThrow("User not found");
    }
  });

  it("throws when auth resolves to an invalid user id", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:broken" as never);
    const dbGet = vi.fn().mockRejectedValue(new Error("Table mismatch"));

    await expect(
      requireUser({
        db: { get: dbGet },
      } as never),
    ).rejects.toThrow("User not found");
  });

  it("returns auth user when active", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:2" as never);
    const user = { _id: "users:2", role: "user" };
    const dbGet = vi.fn().mockResolvedValue(user as never);

    const result = await requireUser({
      db: { get: dbGet },
    } as never);

    expect(dbGet).toHaveBeenCalledWith("users:2");
    expect(result).toEqual({ userId: "users:2", user });
  });

  it("uses the local dev impersonation user before browser auth", async () => {
    const previousHandle = process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE;
    const previousEnabled = process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION;
    try {
      process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE = "local";
      process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION = "1";
      vi.mocked(getAuthUserId).mockResolvedValue("users:browser" as never);
      const user = { _id: "users:local", handle: "local", role: "admin" };
      const unique = vi.fn().mockResolvedValue(user as never);
      const withIndex = vi.fn().mockReturnValue({ unique });
      const query = vi.fn().mockReturnValue({ withIndex });
      const dbGet = vi.fn().mockResolvedValue(user as never);

      const result = await requireUser({
        db: { get: dbGet, query },
      } as never);

      expect(query).toHaveBeenCalledWith("users");
      expect(withIndex).toHaveBeenCalledWith("handle", expect.any(Function));
      expect(dbGet).toHaveBeenCalledWith("users:local");
      expect(getAuthUserId).not.toHaveBeenCalled();
      expect(result).toEqual({ userId: "users:local", user });
    } finally {
      if (previousHandle === undefined) delete process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE;
      else process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE = previousHandle;
      if (previousEnabled === undefined) delete process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION;
      else process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION = previousEnabled;
    }
  });

  it("does not use local dev impersonation in production deployments", async () => {
    const previousHandle = process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE;
    const previousEnabled = process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION;
    const previousDeployment = process.env.CONVEX_DEPLOYMENT;
    try {
      process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE = "local";
      process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION = "1";
      process.env.CONVEX_DEPLOYMENT = "prod:wry-manatee-359";
      vi.mocked(getAuthUserId).mockResolvedValue("users:browser" as never);
      const user = { _id: "users:browser", handle: "browser", role: "user" };
      const query = vi.fn();
      const dbGet = vi.fn().mockResolvedValue(user as never);

      const result = await requireUser({
        db: { get: dbGet, query },
      } as never);

      expect(query).not.toHaveBeenCalled();
      expect(getAuthUserId).toHaveBeenCalled();
      expect(dbGet).toHaveBeenCalledWith("users:browser");
      expect(result).toEqual({ userId: "users:browser", user });
    } finally {
      if (previousHandle === undefined) delete process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE;
      else process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE = previousHandle;
      if (previousEnabled === undefined) delete process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION;
      else process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION = previousEnabled;
      if (previousDeployment === undefined) delete process.env.CONVEX_DEPLOYMENT;
      else process.env.CONVEX_DEPLOYMENT = previousDeployment;
    }
  });
});

describe("access.requireUserFromAction", () => {
  it("throws when auth is missing", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null);
    await expect(
      requireUserFromAction({
        runQuery: vi.fn(),
      } as never),
    ).rejects.toThrow("Unauthorized");
  });

  it("throws when action lookup returns deleted/deactivated/missing user", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:1" as never);

    for (const value of [
      null,
      { _id: "users:1", deletedAt: Date.now() },
      { _id: "users:1", deactivatedAt: Date.now() },
    ]) {
      const runQuery = vi.fn().mockResolvedValue(value as never);
      await expect(
        requireUserFromAction({
          runQuery,
        } as never),
      ).rejects.toThrow("User not found");
    }
  });

  it("throws when action auth resolves to an invalid user id", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:broken" as never);
    const runQuery = vi.fn().mockRejectedValue(new Error("Table mismatch"));

    await expect(
      requireUserFromAction({
        runQuery,
      } as never),
    ).rejects.toThrow("User not found");
  });

  it("returns active user from action query", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:9" as never);
    const user = { _id: "users:9", role: "admin" };
    const runQuery = vi.fn().mockResolvedValue(user as never);

    const result = await requireUserFromAction({
      runQuery,
    } as never);

    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ userId: "users:9", user });
  });

  it("uses the local dev impersonation user before action auth", async () => {
    const previousHandle = process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE;
    const previousEnabled = process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION;
    try {
      process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE = "local";
      process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION = "1";
      vi.mocked(getAuthUserId).mockResolvedValue("users:browser" as never);
      const user = { _id: "users:local", handle: "local", role: "admin" };
      const runQuery = vi.fn(async (_query, args: { handle?: string; userId?: string }) => {
        if (args.handle === "local") return user;
        if (args.userId === "users:local") return user;
        return null;
      });

      const result = await requireUserFromAction({ runQuery } as never);

      expect(runQuery).toHaveBeenCalledTimes(2);
      expect(runQuery).toHaveBeenNthCalledWith(1, expect.anything(), { handle: "local" });
      expect(runQuery).toHaveBeenNthCalledWith(2, expect.anything(), {
        userId: "users:local",
      });
      expect(getAuthUserId).not.toHaveBeenCalled();
      expect(result).toEqual({ userId: "users:local", user });
    } finally {
      if (previousHandle === undefined) delete process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE;
      else process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE = previousHandle;
      if (previousEnabled === undefined) delete process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION;
      else process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION = previousEnabled;
    }
  });
});

describe("access role assertions", () => {
  it("assertRole allows matching roles and rejects missing role", () => {
    expect(() => assertRole({ role: "admin" } as never, ["admin"])).not.toThrow();
    expect(() => assertRole({ role: undefined } as never, ["admin"])).toThrow("Forbidden");
    expect(() => assertRole({ role: "user" } as never, ["admin"])).toThrow("Forbidden");
  });

  it("assertAdmin/assertModerator enforce expected policy", () => {
    expect(() => assertAdmin({ role: "admin" } as never)).not.toThrow();
    expect(() => assertAdmin({ role: "moderator" } as never)).toThrow("Forbidden");

    expect(() => assertModerator({ role: "admin" } as never)).not.toThrow();
    expect(() => assertModerator({ role: "moderator" } as never)).not.toThrow();
    expect(() => assertModerator({ role: "user" } as never)).toThrow("Forbidden");
  });
});
