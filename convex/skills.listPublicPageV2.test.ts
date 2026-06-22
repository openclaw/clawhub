/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

import { listPublicPageV2 } from "./skills";

type ListArgs = {
  paginationOpts: { cursor: string | null; numItems: number; id?: number };
  sort?: "newest" | "updated" | "downloads" | "installs" | "stars" | "name";
  dir?: "asc" | "desc";
  highlightedOnly?: boolean;
  nonSuspiciousOnly?: boolean;
};

type ListResult = {
  page: unknown[];
  continueCursor: string;
  isDone: boolean;
};

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const listPublicPageV2Handler = (
  listPublicPageV2 as unknown as WrappedHandler<ListArgs, ListResult>
)._handler;

describe("skills.listPublicPageV2 (deprecated stub)", () => {
  it("returns empty results with no DB reads", async () => {
    const ctx = {
      db: {
        query: vi.fn(),
        get: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    const result = await listPublicPageV2Handler(ctx, {
      paginationOpts: { cursor: null, numItems: 25 },
      sort: "downloads",
      dir: "desc",
      highlightedOnly: false,
      nonSuspiciousOnly: false,
    });

    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(true);
    expect(result.continueCursor).toBe("");
    expect(ctx.db.query).not.toHaveBeenCalled();
    expect(ctx.db.get).not.toHaveBeenCalled();
  });
});
