import { describe, expect, it } from "vitest";
import {
  CATALOG_FEED_CHANGES_PAYLOAD_TYPE,
  CATALOG_FEED_QUERY_PAYLOAD_TYPE,
  normalizeCatalogFeedQuery,
  parseCatalogFeedChangePages,
  parseCatalogFeedChangePage,
  parseCatalogFeedQueryPages,
  parseCatalogFeedQueryPage,
  parseCatalogFeedResetRequired,
  type CatalogFeedChangePage,
  type CatalogFeedQueryPage,
} from "./catalogFeedDistribution.js";

const entry = {
  type: "plugin" as const,
  id: "@openclaw/demo",
  title: "Demo",
  version: "1.2.3",
  state: "available" as const,
  publisher: { id: "openclaw", trust: "official" as const },
  install: {
    candidates: [
      {
        sourceRef: "public-clawhub",
        package: "@openclaw/demo",
        version: "1.2.3",
        integrity: "sha256:abc",
      },
    ],
  },
};

function queryPage(overrides: Partial<CatalogFeedQueryPage> = {}): CatalogFeedQueryPage {
  return {
    schemaVersion: 1,
    feedId: "clawhub-official",
    sequence: 4,
    generatedAt: "2026-07-16T00:00:00.000Z",
    expiresAt: "2026-07-16T00:05:00.000Z",
    query: { text: "demo", types: ["plugin"] },
    requestCursor: null,
    pageIndex: 0,
    startIndex: 0,
    resultCount: 1,
    entries: [entry],
    nextCursor: null,
    ...overrides,
  };
}

function changePage(overrides: Partial<CatalogFeedChangePage> = {}): CatalogFeedChangePage {
  return {
    schemaVersion: 1,
    feedId: "clawhub-official",
    fromSequence: 3,
    toSequence: 4,
    generatedAt: "2026-07-16T00:00:00.000Z",
    expiresAt: "2026-07-16T00:05:00.000Z",
    requestCursor: null,
    pageIndex: 0,
    startIndex: 0,
    changeCount: 1,
    changes: [{ sequence: 4, operation: "upsert", entry }],
    nextCursor: null,
    ...overrides,
  };
}

describe("catalog feed distribution schema", () => {
  it("binds distinct payload types to query and change representations", () => {
    expect(CATALOG_FEED_QUERY_PAYLOAD_TYPE).toContain("query-results.v1");
    expect(CATALOG_FEED_CHANGES_PAYLOAD_TYPE).toContain("changes.v1");
    expect(new Set([CATALOG_FEED_QUERY_PAYLOAD_TYPE, CATALOG_FEED_CHANGES_PAYLOAD_TYPE]).size).toBe(
      2,
    );
  });

  it("normalizes every bounded catalog query filter", () => {
    expect(
      normalizeCatalogFeedQuery({
        text: "\tCafe\u0301\r\n tools ",
        types: ["skill", "plugin", "skill"],
        states: ["blocked", "available", "blocked"],
        publisherIds: ["zeta", "alpha", "zeta"],
      }),
    ).toEqual({
      text: "Caf\u00e9 tools",
      types: ["plugin", "skill"],
      states: ["available", "blocked"],
      publisherIds: ["alpha", "zeta"],
    });
    expect(() => normalizeCatalogFeedQuery({})).toThrow("at least one filter");
    expect(() => normalizeCatalogFeedQuery({ text: "   " })).toThrow("1 and 256");
    expect(() => normalizeCatalogFeedQuery({ types: [] })).toThrow("must not be empty");
    expect(() => normalizeCatalogFeedQuery({ publisherIds: [] })).toThrow("between 1 and 100");
  });

  it("accepts normalized query pages and rejects ambiguous pagination", () => {
    expect(parseCatalogFeedQueryPage(queryPage()).entries).toHaveLength(1);
    expect(() =>
      parseCatalogFeedQueryPage(queryPage({ query: { types: ["skill", "plugin"] } })),
    ).toThrow("normalized query");
    expect(() => parseCatalogFeedQueryPage(queryPage({ pageIndex: 1 }))).toThrow("first page");
    expect(() =>
      parseCatalogFeedQueryPage(queryPage({ resultCount: 2, nextCursor: null })),
    ).toThrow("terminal page");
    expect(() =>
      parseCatalogFeedQueryPage(queryPage({ entries: Array.from({ length: 201 }, () => entry) })),
    ).toThrow("exceeds 200 entries");
    expect(() => parseCatalogFeedQueryPage(queryPage({ query: { types: ["skill"] } }))).toThrow(
      "requested types",
    );
    expect(() =>
      parseCatalogFeedQueryPage(queryPage({ entries: [entry, entry], resultCount: 2 })),
    ).toThrow("duplicate entry identities");
    const skillWithPluginId = { ...entry, type: "skill" as const };
    expect(
      parseCatalogFeedQueryPage(
        queryPage({
          query: { text: "demo", types: ["plugin", "skill"] },
          entries: [entry, skillWithPluginId],
          resultCount: 2,
        }),
      ).entries,
    ).toEqual([entry, skillWithPluginId]);
    expect(() => parseCatalogFeedQueryPage(queryPage({ nextCursor: "after-end" }))).toThrow(
      "make progress",
    );
    expect(() =>
      parseCatalogFeedQueryPage(
        queryPage({ entries: [], resultCount: 1, nextCursor: "empty-page" }),
      ),
    ).toThrow("make progress");
    expect(() =>
      parseCatalogFeedQueryPage(
        queryPage({
          requestCursor: "same",
          nextCursor: "same",
          pageIndex: 1,
          startIndex: 1,
          resultCount: 3,
        }),
      ),
    ).toThrow("must differ");
    expect(() =>
      parseCatalogFeedQueryPage(
        queryPage({
          requestCursor: "page-two",
          pageIndex: 2,
          startIndex: 1,
          resultCount: 2,
        }),
      ),
    ).toThrow("cannot precede");
  });

  it("validates complete query page chains", () => {
    const query = { text: "demo", types: ["plugin", "skill"] as const };
    const skillWithPluginId = { ...entry, type: "skill" as const };
    const first = queryPage({ query, resultCount: 2, nextCursor: "query-page-2" });
    const second = queryPage({
      query,
      requestCursor: "query-page-2",
      pageIndex: 1,
      startIndex: 1,
      resultCount: 2,
      entries: [skillWithPluginId],
    });
    expect(parseCatalogFeedQueryPages([first, second])).toHaveLength(2);
    expect(() => parseCatalogFeedQueryPages([first])).toThrow("terminal page");
    expect(() =>
      parseCatalogFeedQueryPages([first, { ...second, requestCursor: "wrong-cursor" }]),
    ).toThrow("cursor, page, or offset gap");
    expect(() =>
      parseCatalogFeedQueryPages([
        { ...first, resultCount: 4 },
        { ...second, resultCount: 4, nextCursor: "query-page-3" },
        {
          ...second,
          requestCursor: "query-page-3",
          nextCursor: "query-page-2",
          pageIndex: 2,
          startIndex: 2,
          resultCount: 4,
          entries: [{ ...skillWithPluginId, id: "@openclaw/demo-2" }],
        },
        {
          ...second,
          requestCursor: "query-page-2",
          pageIndex: 3,
          startIndex: 3,
          resultCount: 4,
          entries: [{ ...skillWithPluginId, id: "@openclaw/demo-3" }],
        },
      ]),
    ).toThrow("reuses a continuation cursor");
  });

  it("accepts ordered changes and keeps blocked entries as upserts", () => {
    const blockedEntry = { ...entry, state: "blocked" as const };
    const parsed = parseCatalogFeedChangePage(
      changePage({
        fromSequence: 2,
        changeCount: 3,
        changes: [
          { sequence: 3, operation: "remove", entryId: "old", entryType: "plugin" },
          { sequence: 4, operation: "upsert", entry: blockedEntry },
          { sequence: 4, operation: "metadata", metadata: { description: "Official" } },
        ],
      }),
    );
    expect(parsed.changes[1]).toMatchObject({ operation: "upsert", entry: { state: "blocked" } });
    expect(() =>
      parseCatalogFeedChangePage(
        changePage({
          fromSequence: 1,
          toSequence: 3,
          changeCount: 3,
          changes: [
            { sequence: 2, operation: "upsert", entry },
            { sequence: 3, operation: "metadata", metadata: { description: "Official" } },
            { sequence: 2, operation: "remove", entryId: "old", entryType: "plugin" },
          ],
        }),
      ),
    ).toThrow("ordered by sequence");
    expect(() =>
      parseCatalogFeedChangePage(
        changePage({
          changes: [{ sequence: 4, operation: "upsert", entry: { ...entry, id: "x".repeat(257) } }],
        }),
      ),
    ).toThrow("upsert entry id");
    expect(() =>
      parseCatalogFeedChangePage(
        changePage({
          changes: [
            { sequence: 4, operation: "metadata", metadata: { description: "x".repeat(1_025) } },
          ],
        }),
      ),
    ).toThrow("metadata description");
    expect(() =>
      parseCatalogFeedChangePage(
        changePage({
          toSequence: 5,
          changes: [{ sequence: 4, operation: "upsert", entry }],
        }),
      ),
    ).toThrow("reach toSequence");
    expect(() =>
      parseCatalogFeedChangePage(
        changePage({
          fromSequence: 2,
          toSequence: 4,
          changes: [{ sequence: 4, operation: "upsert", entry }],
        }),
      ),
    ).toThrow("missing revision");
    expect(() =>
      parseCatalogFeedChangePage(
        changePage({ fromSequence: 3, toSequence: 4, changeCount: 0, changes: [] }),
      ),
    ).toThrow("reach toSequence");
    expect(
      parseCatalogFeedChangePage(
        changePage({ fromSequence: 4, toSequence: 4, changeCount: 0, changes: [] }),
      ).changes,
    ).toEqual([]);
  });

  it("validates revision continuity across change page boundaries", () => {
    const first = changePage({
      fromSequence: 2,
      toSequence: 4,
      changeCount: 2,
      changes: [{ sequence: 3, operation: "upsert", entry }],
      nextCursor: "change-page-2",
    });
    const second = changePage({
      fromSequence: 2,
      toSequence: 4,
      requestCursor: "change-page-2",
      pageIndex: 1,
      startIndex: 1,
      changeCount: 2,
      changes: [{ sequence: 4, operation: "metadata", metadata: { description: "Official" } }],
    });
    expect(parseCatalogFeedChangePages([first, second])).toHaveLength(2);
    expect(() =>
      parseCatalogFeedChangePages([first, { ...second, expiresAt: "2026-07-16T00:06:00.000Z" }]),
    ).toThrow("changed its pinned range");
    expect(() => parseCatalogFeedChangePages([first])).toThrow("terminal page");
    expect(() =>
      parseCatalogFeedChangePages([
        { ...first, toSequence: 5 },
        {
          ...second,
          toSequence: 5,
          changes: [{ sequence: 5, operation: "metadata", metadata: { description: "Official" } }],
        },
      ]),
    ).toThrow("missing revision");
    expect(() =>
      parseCatalogFeedChangePages([
        { ...first, toSequence: 5, changeCount: 4 },
        { ...second, toSequence: 5, changeCount: 4, nextCursor: "change-page-3" },
        {
          ...second,
          toSequence: 5,
          requestCursor: "change-page-3",
          nextCursor: "change-page-2",
          pageIndex: 2,
          startIndex: 2,
          changeCount: 4,
          changes: [{ sequence: 5, operation: "metadata", metadata: { description: "Official" } }],
        },
        {
          ...second,
          toSequence: 5,
          requestCursor: "change-page-2",
          pageIndex: 3,
          startIndex: 3,
          changeCount: 4,
          changes: [{ sequence: 5, operation: "metadata", metadata: { description: "Official" } }],
        },
      ]),
    ).toThrow("reuses a continuation cursor");
  });

  it("rejects invalid ranges, expiry windows, and reset locations", () => {
    expect(() => parseCatalogFeedChangePage(changePage({ toSequence: 2 }))).toThrow(
      "must not precede",
    );
    expect(() =>
      parseCatalogFeedQueryPage(queryPage({ expiresAt: "2026-07-15T00:00:00.000Z" })),
    ).toThrow("after generatedAt");
    expect(() => parseCatalogFeedQueryPage(queryPage({ generatedAt: "July 16, 2026" }))).toThrow(
      "RFC 3339",
    );
    expect(() =>
      parseCatalogFeedQueryPage(queryPage({ generatedAt: "2026-02-30T00:00:00Z" })),
    ).toThrow("RFC 3339");
    const reset = {
      schemaVersion: 1,
      feedId: "clawhub-official",
      fromSequence: 2,
      currentSequence: 4,
      generatedAt: "2026-07-16T00:00:00.000Z",
      expiresAt: "2026-07-16T00:05:00.000Z",
      resetRequired: true as const,
      snapshotUrl: "https://clawhub.ai/api/v1/feeds/plugins",
    };
    expect(parseCatalogFeedResetRequired(reset).currentSequence).toBe(4);
    expect(() => parseCatalogFeedResetRequired({ ...reset, currentSequence: 2 })).toThrow(
      "must follow",
    );
    const credentialedUrl = new URL(reset.snapshotUrl);
    credentialedUrl.username = "test-user";
    credentialedUrl.password = ["test", "password"].join("-");
    expect(() =>
      parseCatalogFeedResetRequired({ ...reset, snapshotUrl: credentialedUrl.href }),
    ).toThrow("without credentials");
  });
});
