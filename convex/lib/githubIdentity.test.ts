import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  canHealSkillOwnershipByGitHubProviderAccountId,
  getGitHubProviderAccountId,
} from "./githubIdentity";

describe("canHealSkillOwnershipByGitHubProviderAccountId", () => {
  it("denies when either providerAccountId is missing", () => {
    expect(canHealSkillOwnershipByGitHubProviderAccountId(undefined, undefined)).toBe(false);
    expect(canHealSkillOwnershipByGitHubProviderAccountId("123", undefined)).toBe(false);
    expect(canHealSkillOwnershipByGitHubProviderAccountId(undefined, "123")).toBe(false);
    expect(canHealSkillOwnershipByGitHubProviderAccountId(null, "123")).toBe(false);
  });

  it("denies when providerAccountId differs", () => {
    expect(canHealSkillOwnershipByGitHubProviderAccountId("123", "456")).toBe(false);
  });

  it("allows when providerAccountId matches", () => {
    expect(canHealSkillOwnershipByGitHubProviderAccountId("123", "123")).toBe(true);
  });
});

describe("getGitHubProviderAccountId", () => {
  const userId = "users:github-user" as Id<"users">;

  it("returns null when the user has no GitHub auth account", async () => {
    const ctx = createQueryCtx([]);

    await expect(getGitHubProviderAccountId(ctx, userId)).resolves.toBeNull();
  });

  it("returns the providerAccountId for duplicate rows with the same GitHub identity", async () => {
    const ctx = createQueryCtx([
      createAuthAccount("authAccounts:first", "123"),
      createAuthAccount("authAccounts:second", "123"),
    ]);

    await expect(getGitHubProviderAccountId(ctx, userId)).resolves.toBe("123");
  });

  it("fails closed when duplicate rows disagree on the GitHub identity", async () => {
    const ctx = createQueryCtx([
      createAuthAccount("authAccounts:first", "123"),
      createAuthAccount("authAccounts:second", "456"),
    ]);

    await expect(getGitHubProviderAccountId(ctx, userId)).rejects.toThrow(
      "Conflicting GitHub auth accounts for user users:github-user: [authAccounts:first, authAccounts:second]",
    );
  });

  it("fails closed when duplicate rows exceed the bounded reconciliation window", async () => {
    const ctx = createQueryCtx(
      Array.from({ length: 11 }, (_, index) =>
        createAuthAccount(`authAccounts:${index + 1}`, "123"),
      ),
    );

    await expect(getGitHubProviderAccountId(ctx, userId)).rejects.toThrow(
      "Too many GitHub auth accounts for user users:github-user; manual reconciliation required: [authAccounts:1, authAccounts:2, authAccounts:3, authAccounts:4, authAccounts:5, authAccounts:6, authAccounts:7, authAccounts:8, authAccounts:9, authAccounts:10, authAccounts:11]",
    );
  });

  function createAuthAccount(id: string, providerAccountId: string): Doc<"authAccounts"> {
    return {
      _id: id,
      _creationTime: 1,
      userId,
      provider: "github",
      providerAccountId,
    } as unknown as Doc<"authAccounts">;
  }

  function createQueryCtx(accounts: Array<Doc<"authAccounts">>): Pick<QueryCtx, "db"> {
    const builder = {
      eq: () => builder,
    };
    const query = {
      withIndex: (name: string, configure: (q: typeof builder) => typeof builder) => {
        expect(name).toBe("userIdAndProvider");
        configure(builder);
        return {
          take: async (limit: number) => accounts.slice(0, limit),
        };
      },
    };

    return {
      db: {
        query: (table: string) => {
          expect(table).toBe("authAccounts");
          return query;
        },
      },
    } as unknown as Pick<QueryCtx, "db">;
  }
});
