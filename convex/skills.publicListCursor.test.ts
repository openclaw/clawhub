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
const { listPublicApiPageV1, listPublicPageV4 } = await import("./skills");

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

type PublicListArgs = {
  cursor?: string;
  numItems?: number;
  sort?: "newest" | "updated" | "downloads" | "installs" | "stars" | "name";
  dir?: "asc" | "desc";
  highlightedOnly?: boolean;
  nonSuspiciousOnly?: boolean;
  capabilityTag?: string;
};

type PublicListResult = {
  page: unknown[];
  hasMore: boolean;
  nextCursor: string | null;
};

type PublicApiListResult = {
  items: unknown[];
  nextCursor: string | null;
};

const getPageMock = pagination.getPage as unknown as ReturnType<typeof vi.fn>;
const listPublicPageV4Handler = (
  listPublicPageV4 as unknown as WrappedHandler<PublicListArgs, PublicListResult>
)._handler;
const listPublicApiPageV1Handler = (
  listPublicApiPageV1 as unknown as WrappedHandler<PublicListArgs, PublicApiListResult>
)._handler;

function legacyCursor(key: unknown[]): string {
  return JSON.stringify(key);
}

function cursorForIndex(index: string, key: unknown[]): string {
  return JSON.stringify({ v: 1, index, key });
}

describe("public skill list deterministic cursors", () => {
  beforeEach(() => {
    getPageMock.mockReset();
    getPageMock.mockResolvedValue({ page: [], hasMore: false, indexKeys: [] });
  });

  it("ignores stale legacy cursors that are longer than the selected index", async () => {
    const staleDownloadsCursor = legacyCursor([{ __undef: 1 }, false, 100, 200]);

    await listPublicPageV4Handler({} as never, {
      cursor: staleDownloadsCursor,
      sort: "name",
      nonSuspiciousOnly: false,
      numItems: 10,
    });

    expect(getPageMock).toHaveBeenCalledTimes(1);
    expect(getPageMock.mock.calls[0]?.[1]).toMatchObject({
      index: "by_active_name",
      startIndexKey: [undefined],
      startInclusive: true,
    });
  });

  it("ignores self-describing cursors from a different selected index", async () => {
    const staleCursor = cursorForIndex("by_nonsuspicious_downloads", [
      { __undef: 1 },
      false,
      100,
      200,
    ]);

    await listPublicPageV4Handler({} as never, {
      cursor: staleCursor,
      sort: "downloads",
      nonSuspiciousOnly: false,
      numItems: 10,
    });

    expect(getPageMock).toHaveBeenCalledTimes(1);
    expect(getPageMock.mock.calls[0]?.[1]).toMatchObject({
      index: "by_active_stats_downloads",
      startIndexKey: [undefined],
      startInclusive: true,
    });
  });

  it("continues from valid cursors and emits the selected index with the next cursor", async () => {
    getPageMock.mockResolvedValueOnce({
      page: [],
      hasMore: true,
      indexKeys: [[undefined, "delta", 200, "skillSearchDigest:delta"]],
    });
    const validCursor = cursorForIndex("by_active_name", [
      { __undef: 1 },
      "beta",
      100,
      "skillSearchDigest:beta",
    ]);

    const result = await listPublicPageV4Handler({} as never, {
      cursor: validCursor,
      sort: "name",
      nonSuspiciousOnly: false,
      numItems: 10,
    });

    expect(getPageMock.mock.calls[0]?.[1]).toMatchObject({
      index: "by_active_name",
      startIndexKey: [undefined, "beta", 100, "skillSearchDigest:beta"],
      startInclusive: false,
    });
    expect(JSON.parse(result.nextCursor ?? "")).toEqual({
      v: 1,
      index: "by_active_name",
      key: [{ __undef: 1 }, "delta", 200, "skillSearchDigest:delta"],
    });
  });

  it("guards the public API list against stale index cursors too", async () => {
    const staleCursor = legacyCursor([{ __undef: 1 }, false, 100, 200]);

    await listPublicApiPageV1Handler({} as never, {
      cursor: staleCursor,
      sort: "updated",
      nonSuspiciousOnly: false,
      numItems: 10,
    });

    expect(getPageMock).toHaveBeenCalledTimes(1);
    expect(getPageMock.mock.calls[0]?.[1]).toMatchObject({
      index: "by_active_updated",
      startIndexKey: [undefined],
      startInclusive: true,
    });
  });

  it("paginates the public API list from getPage's full self-describing cursor", async () => {
    getPageMock
      .mockResolvedValueOnce({
        page: [],
        hasMore: true,
        indexKeys: [[undefined, 200, 201, "skillSearchDigest:alpha"]],
      })
      .mockResolvedValueOnce({
        page: [],
        hasMore: false,
        indexKeys: [[undefined, 300, 301, "skillSearchDigest:beta"]],
      });

    const first = await listPublicApiPageV1Handler({} as never, {
      sort: "updated",
      nonSuspiciousOnly: false,
      numItems: 1,
    });

    expect(first.nextCursor).not.toBeNull();
    expect(getPageMock.mock.calls[0]?.[1]).toMatchObject({
      index: "by_active_updated",
      startIndexKey: [undefined],
      startInclusive: true,
    });

    const second = await listPublicApiPageV1Handler({} as never, {
      cursor: first.nextCursor!,
      sort: "updated",
      nonSuspiciousOnly: false,
      numItems: 1,
    });

    expect(second.nextCursor).toBeNull();
    expect(getPageMock.mock.calls[1]?.[1]).toMatchObject({
      index: "by_active_updated",
      startIndexKey: [undefined, 200, 201, "skillSearchDigest:alpha"],
      startInclusive: false,
    });
  });
});
