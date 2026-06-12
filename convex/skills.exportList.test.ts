/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("convex-helpers/server/pagination", async () => {
  const actual = await vi.importActual<typeof import("convex-helpers/server/pagination")>(
    "convex-helpers/server/pagination",
  );
  return {
    ...actual,
    getPage: vi.fn(),
  };
});

const pagination = await import("convex-helpers/server/pagination");
const { listByDateRange } = await import("./skills");

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

type ExportListResult = {
  page: Array<{ slug: string }>;
  hasMore: boolean;
  nextCursor: string | null;
};

const getPageMock = pagination.getPage as unknown as ReturnType<typeof vi.fn>;
const listByDateRangeHandler = (
  listByDateRange as unknown as WrappedHandler<
    { startDate: number; endDate: number; cursor?: string; numItems?: number },
    ExportListResult
  >
)._handler;

beforeEach(() => {
  getPageMock.mockReset();
});

function digest(overrides: Record<string, unknown>) {
  return {
    skillId: "skills:base",
    slug: "base",
    displayName: "Base",
    ownerUserId: "users:owner",
    latestVersionId: "skillVersions:base",
    tags: {},
    stats: {},
    softDeletedAt: undefined,
    moderationStatus: "active",
    moderationFlags: [],
    isSuspicious: false,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("skills.listByDateRange export list", () => {
  it("uses updated cursors and returns only exportable public installable skills", async () => {
    getPageMock.mockResolvedValue({
      page: [
        digest({ slug: "exportable" }),
        digest({ slug: "missing-version", latestVersionId: undefined }),
        digest({ slug: "hidden", moderationStatus: "hidden" }),
        digest({ slug: "malicious", moderationFlags: ["blocked.malware"] }),
        digest({ slug: "deleted", softDeletedAt: 10 }),
      ],
      hasMore: false,
      indexKeys: [[undefined, 2]],
    });

    const result = await listByDateRangeHandler({ db: {} }, { startDate: 1, endDate: 5 });

    expect(result.page.map((item) => item.slug)).toEqual(["exportable"]);
    expect(getPageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        table: "skillSearchDigest",
        index: "by_active_updated",
        startIndexKey: [undefined, 5],
        endIndexKey: [undefined, 1],
      }),
    );
  });

  it("caps requested export list pages at 250 rows", async () => {
    getPageMock.mockResolvedValue({
      page: [],
      hasMore: false,
      indexKeys: [],
    });

    await listByDateRangeHandler({ db: {} }, { startDate: 1, endDate: 5, numItems: 1_000 });

    expect(getPageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        absoluteMaxRows: 250,
      }),
    );
  });

  it("accepts existing anonymous cursors for later export pages", async () => {
    getPageMock.mockResolvedValue({
      page: [],
      hasMore: false,
      indexKeys: [],
    });

    await listByDateRangeHandler(
      { db: {} },
      { startDate: 1, endDate: 5, cursor: JSON.stringify([{ __undef: 1 }, 4]) },
    );

    expect(getPageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        startIndexKey: [undefined, 4],
        startInclusive: false,
      }),
    );
  });
});
