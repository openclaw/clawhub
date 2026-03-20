import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { getSkillBySlugInternal } from "./skills";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getSkillBySlugInternalHandler = (
  getSkillBySlugInternal as unknown as WrappedHandler<{ slug: string }>
)._handler;

describe("skills ownership", () => {
  it("resolves alias slugs to the live target skill", async () => {
    const result = await getSkillBySlugInternalHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "skills:target") {
              return {
                _id: "skills:target",
                slug: "demo",
                ownerUserId: "users:1",
              };
            }
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "skills") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_slug") throw new Error(`unexpected skills index ${name}`);
                  return {
                    unique: async () => null,
                  };
                },
              };
            }
            if (table === "skillSlugAliases") {
              return {
                withIndex: (name: string) => {
                  if (name !== "by_slug") throw new Error(`unexpected alias index ${name}`);
                  return {
                    unique: async () => ({
                      _id: "skillSlugAliases:1",
                      slug: "demo-old",
                      skillId: "skills:target",
                    }),
                  };
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          }),
        },
      } as never,
      { slug: "demo-old" } as never,
    );

    expect(result).toEqual(
      expect.objectContaining({
        _id: "skills:target",
        slug: "demo",
      }),
    );
  });
});
