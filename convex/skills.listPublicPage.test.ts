/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { getTestHandler } from "../src/__tests__/helpers/convexHandler";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { listPublicPage } from "./skills";

type ListArgs = {
  cursor?: string;
  limit?: number;
  sort?: "updated" | "downloads" | "stars" | "installsCurrent" | "installsAllTime" | "trending";
  nonSuspiciousOnly?: boolean;
};

type ListResult = {
  items: unknown[];
  nextCursor: string | null;
};

const listPublicPageHandler = getTestHandler<ListArgs, ListResult>(listPublicPage);

describe("skills.listPublicPage (deprecated stub)", () => {
  it("returns empty results with no DB reads", async () => {
    const ctx = {
      db: {
        query: vi.fn(),
        get: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    const result = await listPublicPageHandler(ctx, {
      sort: "updated",
      limit: 10,
      nonSuspiciousOnly: true,
    });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.db.get).not.toHaveBeenCalled();
  });
});
