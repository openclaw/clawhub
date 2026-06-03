import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  getSkillBySlugForPublisher,
  getSkillSlugAliasBySlugForPublisher,
  getSkillSlugAliasBySlugScoped,
  resolveLegacySkillBySlugOrAlias,
  resolvePublisherByOwnerHandle,
} from "./slugResolution";

function doc<TableName extends "users" | "publishers" | "skills" | "skillSlugAliases">(
  value: string,
) {
  return value as Id<TableName>;
}

const personalPublisher = {
  _id: doc<"publishers">("publishers:personal"),
  kind: "user",
  handle: "alice",
  linkedUserId: doc<"users">("users:alice"),
} as Doc<"publishers">;

const legacyUnlinkedPersonalPublisher = {
  _id: doc<"publishers">("publishers:personal"),
  kind: "user",
  handle: "alice",
} as Doc<"publishers">;

const aliceUser = {
  _id: doc<"users">("users:alice"),
  handle: "alice",
} as Doc<"users">;

const orgPublisher = {
  _id: doc<"publishers">("publishers:org"),
  kind: "org",
  handle: "alice-org",
} as Doc<"publishers">;

const legacyPersonalSkill = {
  _id: doc<"skills">("skills:personal"),
  slug: "demo",
  ownerUserId: doc<"users">("users:alice"),
} as Doc<"skills">;

const orgSkill = {
  _id: doc<"skills">("skills:org"),
  slug: "demo",
  ownerUserId: doc<"users">("users:alice"),
  ownerPublisherId: orgPublisher._id,
} as Doc<"skills">;

const legacyPersonalAlias = {
  _id: doc<"skillSlugAliases">("skillSlugAliases:personal"),
  slug: "old-demo",
  skillId: legacyPersonalSkill._id,
  ownerUserId: doc<"users">("users:alice"),
} as Doc<"skillSlugAliases">;

const orgAlias = {
  _id: doc<"skillSlugAliases">("skillSlugAliases:org"),
  slug: "old-demo",
  skillId: orgSkill._id,
  ownerUserId: doc<"users">("users:alice"),
  ownerPublisherId: orgPublisher._id,
} as Doc<"skillSlugAliases">;

function makeDb() {
  return {
    get: async (id: string) => {
      if (id === orgSkill._id) return orgSkill;
      if (id === legacyPersonalSkill._id) return legacyPersonalSkill;
      if (id === aliceUser._id) return aliceUser;
      return null;
    },
    query: (table: "skills" | "skillSlugAliases" | "users" | "publishers") => ({
      withIndex: (
        indexName: string,
        build?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
      ) => {
        const constraints: Record<string, string> = {};
        const q = {
          eq: (field: string, value: string) => {
            constraints[field] = value;
            return q;
          },
        };
        build?.(q);

        let matches: unknown[] = [];
        if (table === "skills") {
          matches = [orgSkill, legacyPersonalSkill].filter(
            (skill) =>
              skill.slug === constraints.slug &&
              skill.ownerUserId === constraints.ownerUserId &&
              (!constraints.ownerPublisherId ||
                skill.ownerPublisherId === constraints.ownerPublisherId),
          );
        } else if (table === "skillSlugAliases") {
          matches = [orgAlias, legacyPersonalAlias].filter(
            (alias) =>
              alias.slug === constraints.slug &&
              alias.ownerUserId === constraints.ownerUserId &&
              (!constraints.ownerPublisherId ||
                alias.ownerPublisherId === constraints.ownerPublisherId),
          );
        } else if (table === "users") {
          matches = [aliceUser].filter((user) => user.handle === constraints.handle);
        } else if (table === "publishers") {
          matches = [personalPublisher, orgPublisher].filter((publisher) => {
            if (indexName === "by_handle") return publisher.handle === constraints.handle;
            if (indexName === "by_linked_user") {
              return publisher.linkedUserId === constraints.linkedUserId;
            }
            return false;
          });
        }

        return {
          take: async () => matches,
          unique: async () => {
            if (indexName === "by_owner_slug") {
              throw new Error("legacy owner lookup must not use unique()");
            }
            return matches[0] ?? null;
          },
        };
      },
    }),
  };
}

describe("skill slug owner fallbacks", () => {
  it("filters legacy owner slug matches without requiring global uniqueness", async () => {
    const result = await getSkillBySlugForPublisher(
      { db: makeDb() } as never,
      "demo",
      personalPublisher,
    );

    expect(result?._id).toBe(legacyPersonalSkill._id);
  });

  it("falls back to the handle user for unlinked legacy personal publishers", async () => {
    const bySkill = await getSkillBySlugForPublisher(
      { db: makeDb() } as never,
      "demo",
      legacyUnlinkedPersonalPublisher,
    );
    const byAlias = await getSkillSlugAliasBySlugForPublisher(
      { db: makeDb() } as never,
      "old-demo",
      legacyUnlinkedPersonalPublisher,
    );

    expect(bySkill?._id).toBe(legacyPersonalSkill._id);
    expect(byAlias?._id).toBe(legacyPersonalAlias._id);
  });

  it("filters legacy alias matches without requiring global uniqueness", async () => {
    const byPublisher = await getSkillSlugAliasBySlugForPublisher(
      { db: makeDb() } as never,
      "old-demo",
      personalPublisher,
    );
    const byScopedOwner = await getSkillSlugAliasBySlugScoped(
      { db: makeDb() } as never,
      "old-demo",
      personalPublisher._id,
      personalPublisher.linkedUserId,
    );

    expect(byPublisher?._id).toBe(legacyPersonalAlias._id);
    expect(byScopedOwner?._id).toBe(legacyPersonalAlias._id);
  });

  it("treats malformed owner id strings as missing publishers", async () => {
    const result = await resolvePublisherByOwnerHandle(
      {
        db: {
          get: async () => {
            throw new Error("Invalid ID");
          },
        },
      } as never,
      "publishers:not-a-valid-id",
    );

    expect(result).toEqual({
      requestedHandle: "publishers:not-a-valid-id",
      publisher: null,
    });
  });

  it("treats inactive materialized publishers as missing owners", async () => {
    const inactivePublisher = {
      ...orgPublisher,
      deletedAt: undefined,
      deactivatedAt: Date.now(),
    } as Doc<"publishers">;

    const result = await resolvePublisherByOwnerHandle(
      {
        db: {
          query: (table: "publishers" | "users") => ({
            withIndex: (indexName: string) => {
              if (table === "publishers" && indexName === "by_handle") {
                return { unique: async () => inactivePublisher };
              }
              if (table === "users" && indexName === "handle") {
                throw new Error("inactive publisher handle must not fall through to users");
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          }),
        },
      } as never,
      inactivePublisher.handle,
    );

    expect(result).toEqual({
      requestedHandle: inactivePublisher.handle,
      publisher: null,
    });
  });

  it("treats legacy direct and alias matches as ambiguous before resolving", async () => {
    const directSkill = {
      _id: doc<"skills">("skills:direct"),
      slug: "shared",
      ownerUserId: doc<"users">("users:alice"),
      ownerPublisherId: doc<"publishers">("publishers:alice"),
    } as Doc<"skills">;
    const aliasTarget = {
      _id: doc<"skills">("skills:alias-target"),
      slug: "renamed",
      ownerUserId: doc<"users">("users:bob"),
      ownerPublisherId: doc<"publishers">("publishers:bob"),
    } as Doc<"skills">;
    const alias = {
      _id: doc<"skillSlugAliases">("skillSlugAliases:bob"),
      slug: "shared",
      skillId: aliasTarget._id,
      ownerUserId: doc<"users">("users:bob"),
      ownerPublisherId: doc<"publishers">("publishers:bob"),
    } as Doc<"skillSlugAliases">;
    const publishers = [
      { _id: directSkill.ownerPublisherId, kind: "org", handle: "alice" },
      { _id: aliasTarget.ownerPublisherId, kind: "org", handle: "bob" },
    ];
    const result = await resolveLegacySkillBySlugOrAlias(
      {
        db: {
          get: async (id: string) => {
            if (id === directSkill._id) return directSkill;
            if (id === aliasTarget._id) return aliasTarget;
            return publishers.find((publisher) => publisher._id === id) ?? null;
          },
          query: (table: "skills" | "skillSlugAliases") => ({
            withIndex: (
              indexName: string,
              build?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              const constraints: Record<string, string> = {};
              const q = {
                eq: (field: string, value: string) => {
                  constraints[field] = value;
                  return q;
                },
              };
              build?.(q);
              if (table === "skills" && indexName === "by_slug") {
                return {
                  take: async () => (directSkill.slug === constraints.slug ? [directSkill] : []),
                };
              }
              if (table === "skillSlugAliases" && indexName === "by_slug") {
                return {
                  take: async () => (alias.slug === constraints.slug ? [alias] : []),
                };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          }),
        },
      } as never,
      "shared",
    );

    expect(result).toMatchObject({
      skill: null,
      alias: null,
      ambiguous: true,
      ambiguousMatches: [
        { slug: "shared", ownerHandle: "alice" },
        { slug: "renamed", ownerHandle: "bob" },
      ],
    });
  });

  it("prefers the single public legacy match over hidden duplicate rows", async () => {
    const publicSkill = {
      _id: doc<"skills">("skills:public"),
      slug: "shared",
      ownerUserId: doc<"users">("users:alice"),
      ownerPublisherId: doc<"publishers">("publishers:alice"),
      softDeletedAt: undefined,
      moderationStatus: "active",
      moderationFlags: undefined,
    } as Doc<"skills">;
    const hiddenSkill = {
      _id: doc<"skills">("skills:hidden"),
      slug: "shared",
      ownerUserId: doc<"users">("users:bob"),
      ownerPublisherId: doc<"publishers">("publishers:bob"),
      softDeletedAt: undefined,
      moderationStatus: "hidden",
      moderationFlags: undefined,
    } as Doc<"skills">;

    const result = await resolveLegacySkillBySlugOrAlias(
      {
        db: {
          get: async () => null,
          query: (table: "skills" | "skillSlugAliases") => ({
            withIndex: (
              indexName: string,
              build?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              const constraints: Record<string, string> = {};
              const q = {
                eq: (field: string, value: string) => {
                  constraints[field] = value;
                  return q;
                },
              };
              build?.(q);
              if (table === "skills" && indexName === "by_slug") {
                return {
                  take: async () =>
                    publicSkill.slug === constraints.slug ? [publicSkill, hiddenSkill] : [],
                };
              }
              if (table === "skillSlugAliases" && indexName === "by_slug") {
                return { take: async () => [] };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          }),
        },
      } as never,
      "shared",
    );

    expect(result).toMatchObject({
      skill: publicSkill,
      ambiguous: false,
      ambiguousMatches: [],
    });
  });

  it("does not let a hidden preferred publisher mask the single public match", async () => {
    const publicSkill = {
      _id: doc<"skills">("skills:public"),
      slug: "shared",
      ownerUserId: doc<"users">("users:alice"),
      ownerPublisherId: doc<"publishers">("publishers:alice"),
      softDeletedAt: undefined,
      moderationStatus: "active",
      moderationFlags: undefined,
    } as Doc<"skills">;
    const hiddenPreferredSkill = {
      _id: doc<"skills">("skills:openclaw-hidden"),
      slug: "shared",
      ownerUserId: doc<"users">("users:openclaw"),
      ownerPublisherId: doc<"publishers">("publishers:openclaw"),
      softDeletedAt: undefined,
      moderationStatus: "hidden",
      moderationFlags: undefined,
    } as Doc<"skills">;

    const result = await resolveLegacySkillBySlugOrAlias(
      {
        db: {
          get: async (id: string) => {
            if (id === publicSkill.ownerPublisherId) {
              return { _id: id, kind: "org", handle: "alice" };
            }
            if (id === hiddenPreferredSkill.ownerPublisherId) {
              return { _id: id, kind: "org", handle: "openclaw" };
            }
            return null;
          },
          query: (table: "skills" | "skillSlugAliases") => ({
            withIndex: (
              indexName: string,
              build?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              const constraints: Record<string, string> = {};
              const q = {
                eq: (field: string, value: string) => {
                  constraints[field] = value;
                  return q;
                },
              };
              build?.(q);
              if (table === "skills" && indexName === "by_slug") {
                return {
                  take: async () =>
                    publicSkill.slug === constraints.slug
                      ? [publicSkill, hiddenPreferredSkill]
                      : [],
                };
              }
              if (table === "skillSlugAliases" && indexName === "by_slug") {
                return { take: async () => [] };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          }),
        },
      } as never,
      "shared",
    );

    expect(result).toMatchObject({
      skill: publicSkill,
      ambiguous: false,
      ambiguousMatches: [],
    });
  });

  it("does not let a preferred direct match hide public alias ambiguity", async () => {
    const publicSkill = {
      _id: doc<"skills">("skills:public"),
      slug: "shared",
      ownerUserId: doc<"users">("users:alice"),
      ownerPublisherId: doc<"publishers">("publishers:alice"),
      softDeletedAt: undefined,
      moderationStatus: "active",
      moderationFlags: undefined,
    } as Doc<"skills">;
    const hiddenSkill = {
      _id: doc<"skills">("skills:hidden"),
      slug: "shared",
      ownerUserId: doc<"users">("users:bob"),
      ownerPublisherId: doc<"publishers">("publishers:bob"),
      softDeletedAt: undefined,
      moderationStatus: "hidden",
      moderationFlags: undefined,
    } as Doc<"skills">;
    const aliasTarget = {
      _id: doc<"skills">("skills:alias-target"),
      slug: "renamed",
      ownerUserId: doc<"users">("users:carol"),
      ownerPublisherId: doc<"publishers">("publishers:carol"),
      softDeletedAt: undefined,
      moderationStatus: "active",
      moderationFlags: undefined,
    } as Doc<"skills">;
    const alias = {
      _id: doc<"skillSlugAliases">("skillSlugAliases:carol"),
      slug: "shared",
      skillId: aliasTarget._id,
      ownerUserId: doc<"users">("users:carol"),
      ownerPublisherId: doc<"publishers">("publishers:carol"),
    } as Doc<"skillSlugAliases">;
    const publishers = [
      { _id: publicSkill.ownerPublisherId, kind: "org", handle: "alice" },
      { _id: hiddenSkill.ownerPublisherId, kind: "org", handle: "bob" },
      { _id: aliasTarget.ownerPublisherId, kind: "org", handle: "carol" },
    ];

    const result = await resolveLegacySkillBySlugOrAlias(
      {
        db: {
          get: async (id: string) => {
            if (id === publicSkill._id) return publicSkill;
            if (id === hiddenSkill._id) return hiddenSkill;
            if (id === aliasTarget._id) return aliasTarget;
            return publishers.find((publisher) => publisher._id === id) ?? null;
          },
          query: (table: "skills" | "skillSlugAliases") => ({
            withIndex: (
              indexName: string,
              build?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              const constraints: Record<string, string> = {};
              const q = {
                eq: (field: string, value: string) => {
                  constraints[field] = value;
                  return q;
                },
              };
              build?.(q);
              if (table === "skills" && indexName === "by_slug") {
                return {
                  take: async () =>
                    publicSkill.slug === constraints.slug ? [publicSkill, hiddenSkill] : [],
                };
              }
              if (table === "skillSlugAliases" && indexName === "by_slug") {
                return {
                  take: async () => (alias.slug === constraints.slug ? [alias] : []),
                };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          }),
        },
      } as never,
      "shared",
    );

    expect(result).toMatchObject({
      skill: null,
      alias: null,
      ambiguous: true,
      ambiguousMatches: [
        { slug: "shared", ownerHandle: "alice" },
        { slug: "renamed", ownerHandle: "carol" },
      ],
    });
  });

  it("does not expose hidden-only duplicate owners as public ambiguity choices", async () => {
    const hiddenAliceSkill = {
      _id: doc<"skills">("skills:hidden-alice"),
      slug: "shared",
      ownerUserId: doc<"users">("users:alice"),
      ownerPublisherId: doc<"publishers">("publishers:alice"),
      softDeletedAt: undefined,
      moderationStatus: "hidden",
      moderationFlags: undefined,
    } as Doc<"skills">;
    const removedBobSkill = {
      _id: doc<"skills">("skills:removed-bob"),
      slug: "shared",
      ownerUserId: doc<"users">("users:bob"),
      ownerPublisherId: doc<"publishers">("publishers:bob"),
      softDeletedAt: undefined,
      moderationStatus: "removed",
      moderationFlags: undefined,
    } as Doc<"skills">;

    const result = await resolveLegacySkillBySlugOrAlias(
      {
        db: {
          get: async () => null,
          query: (table: "skills" | "skillSlugAliases") => ({
            withIndex: (
              indexName: string,
              build?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
            ) => {
              const constraints: Record<string, string> = {};
              const q = {
                eq: (field: string, value: string) => {
                  constraints[field] = value;
                  return q;
                },
              };
              build?.(q);
              if (table === "skills" && indexName === "by_slug") {
                return {
                  take: async () =>
                    hiddenAliceSkill.slug === constraints.slug
                      ? [hiddenAliceSkill, removedBobSkill]
                      : [],
                };
              }
              if (table === "skillSlugAliases" && indexName === "by_slug") {
                return { take: async () => [] };
              }
              throw new Error(`unexpected query ${table}.${indexName}`);
            },
          }),
        },
      } as never,
      "shared",
    );

    expect(result).toMatchObject({
      skill: null,
      alias: null,
      ambiguous: false,
      ambiguousMatches: [],
    });
  });
});
