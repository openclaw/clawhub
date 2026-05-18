import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  getSkillBySlugForPublisher,
  getSkillSlugAliasBySlugForPublisher,
  getSkillSlugAliasBySlugScoped,
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

        const matches =
          table === "skills"
            ? [orgSkill, legacyPersonalSkill].filter(
                (skill) =>
                  skill.slug === constraints.slug &&
                  skill.ownerUserId === constraints.ownerUserId &&
                  (!constraints.ownerPublisherId ||
                    skill.ownerPublisherId === constraints.ownerPublisherId),
              )
            : [orgAlias, legacyPersonalAlias].filter(
                (alias) =>
                  alias.slug === constraints.slug &&
                  alias.ownerUserId === constraints.ownerUserId &&
                  (!constraints.ownerPublisherId ||
                    alias.ownerPublisherId === constraints.ownerPublisherId),
              );

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
});
