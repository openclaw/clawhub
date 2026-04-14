import { describe, expect, it, vi } from "vitest";
import { setSkillPublisherInternal } from "./skills";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const setSkillPublisherInternalHandler = (
  setSkillPublisherInternal as unknown as WrappedHandler<{
    actorUserId: string;
    slug: string;
    targetPublisherHandle: string;
    reason?: string;
  }>
)._handler;

describe("setSkillPublisherInternal", () => {
  it("lets moderators move a skill to a target org publisher and updates aliases", async () => {
    const patch = vi.fn(async () => {});
    const insert = vi.fn(async () => "auditLogs:1");
    const get = vi.fn(async (...args: string[]) => {
      const id = args.at(-1);
      if (id === "users:moderator") {
        return {
          _id: "users:moderator",
          role: "moderator",
        };
      }
      return null;
    });
    const query = vi.fn((table: string) => {
      if (table === "skills") {
        return {
          withIndex: (indexName: string) => {
            expect(indexName).toBe("by_slug");
            return {
              unique: async () => ({
                _id: "skills:1",
                slug: "shop",
                ownerUserId: "users:owner",
                ownerPublisherId: "publishers:pushmatrix",
              }),
            };
          },
        };
      }
      if (table === "publishers") {
        return {
          withIndex: (indexName: string) => {
            expect(indexName).toBe("by_handle");
            return {
              unique: async () => ({
                _id: "publishers:shopify",
                handle: "shopify",
              }),
            };
          },
        };
      }
      if (table === "skillSlugAliases") {
        return {
          withIndex: (indexName: string) => {
            expect(indexName).toBe("by_skill");
            return {
              collect: async () => [
                {
                  _id: "skillSlugAliases:1",
                  slug: "shop-old",
                  skillId: "skills:1",
                  ownerUserId: "users:owner",
                  ownerPublisherId: "publishers:pushmatrix",
                },
              ],
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
    const normalizeId = vi.fn((table: string, id: string) => (id.startsWith(`${table}:`) ? id : null));

    const result = (await setSkillPublisherInternalHandler(
      {
        db: {
          get,
          query,
          patch,
          replace: vi.fn(async () => {}),
          delete: vi.fn(async () => {}),
          insert,
          normalizeId,
        },
      } as never,
      {
        actorUserId: "users:moderator",
        slug: "shop",
        targetPublisherHandle: "shopify",
        reason: "org migration",
      } as never,
    )) as {
      ok: boolean;
      changed: boolean;
      skillSlug: string;
      ownerPublisherHandle: string;
      ownerPublisherId: string;
    };

    expect(result).toEqual({
      ok: true,
      changed: true,
      skillSlug: "shop",
      ownerPublisherHandle: "shopify",
      ownerPublisherId: "publishers:shopify",
    });
    expect(patch.mock.calls).toContainEqual([
      "skills",
      "skills:1",
      expect.objectContaining({
        ownerPublisherId: "publishers:shopify",
      }),
    ]);
    expect(patch.mock.calls).toContainEqual([
      "skillSlugAliases:1",
      expect.objectContaining({
        ownerPublisherId: "publishers:shopify",
      }),
    ]);
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "skill.publisher.change",
        metadata: expect.objectContaining({
          slug: "shop",
          fromPublisherId: "publishers:pushmatrix",
          toPublisherId: "publishers:shopify",
          reason: "org migration",
        }),
      }),
    );
  });

  it("rejects non-moderators", async () => {
    await expect(
      setSkillPublisherInternalHandler(
        {
          db: {
            get: vi.fn(async (...args: string[]) => {
              const id = args.at(-1);
              if (id === "users:member") {
                return {
                  _id: "users:member",
                  role: "user",
                };
              }
              return null;
            }),
            query: vi.fn(),
            patch: vi.fn(),
            replace: vi.fn(),
            delete: vi.fn(),
            insert: vi.fn(),
            normalizeId: vi.fn(),
          },
        } as never,
        {
          actorUserId: "users:member",
          slug: "shop",
          targetPublisherHandle: "shopify",
        } as never,
      ),
    ).rejects.toThrow("Forbidden");
  });
});
