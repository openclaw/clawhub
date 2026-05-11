import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");
const { assertAdmin, assertModerator, assertRole, requireUser, requireUserFromAction, isDevImpersonationAllowed } =
  await import("./access");

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

describe("access.isDevImpersonationAllowed", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE;
    delete process.env.CONVEX_DEPLOYMENT;
    delete process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns false when CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE is not 'local'", () => {
    process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE = "other";
    process.env.CONVEX_DEPLOYMENT = "dev:my-deployment";
    expect(isDevImpersonationAllowed()).toBe(false);
  });

  it("blocks deployments starting with prod:", () => {
    process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE = "local";
    process.env.CONVEX_DEPLOYMENT = "prod:my-project";
    expect(isDevImpersonationAllowed()).toBe(false);
  });

  it("blocks deployments containing production", () => {
    process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE = "local";
    process.env.CONVEX_DEPLOYMENT = "my-production-env";
    expect(isDevImpersonationAllowed()).toBe(false);
  });

  it("allows anonymous: deployments", () => {
    process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE = "local";
    process.env.CONVEX_DEPLOYMENT = "anonymous:local-123";
    expect(isDevImpersonationAllowed()).toBe(true);
  });

  it("allows dev: deployments", () => {
    process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE = "local";
    process.env.CONVEX_DEPLOYMENT = "dev:my-project";
    expect(isDevImpersonationAllowed()).toBe(true);
  });

  it("allows local: deployments", () => {
    process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE = "local";
    process.env.CONVEX_DEPLOYMENT = "local:my-project";
    expect(isDevImpersonationAllowed()).toBe(true);
  });

  it("allows non-standard deployments when CLAW_HUB_ENABLE_DEV_IMPERSONATION=1", () => {
    process.env.CLAW_HUB_DEV_IMPERSONATE_USER_HANDLE = "local";
    process.env.CONVEX_DEPLOYMENT = "custom-deployment";
    process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION = "1";
    expect(isDevImpersonationAllowed()).toBe(true);
  });
});
