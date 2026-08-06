import { expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { getLatestPendingSkillVersionInternal } from "./skills";

type WrappedHandler<TArgs> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<unknown>;
};

const getLatestPendingSkillVersionHandler = (
  getLatestPendingSkillVersionInternal as unknown as WrappedHandler<{ skillId: string }>
)._handler;

it("selects a pending latest-projection candidate past a newer-created backport", async () => {
  const pendingBackport = {
    _id: "skillVersions:backport",
    version: "1.5.0",
    publicationStatus: "pending",
  };
  const pendingUpgrade = {
    _id: "skillVersions:upgrade",
    version: "3.0.0",
    publicationStatus: "pending",
  };
  const query = {
    withIndex: vi.fn(),
    order: vi.fn(),
    take: vi.fn().mockResolvedValue([pendingBackport, pendingUpgrade]),
  };
  query.withIndex.mockReturnValue(query);
  query.order.mockReturnValue(query);
  const ctx = {
    db: {
      get: vi.fn().mockResolvedValue({ latestVersionSummary: { version: "2.0.0" } }),
      query: vi.fn().mockReturnValue(query),
    },
  };

  const result = await getLatestPendingSkillVersionHandler(ctx, { skillId: "skills:1" });

  expect(result).toEqual(pendingUpgrade);
});
