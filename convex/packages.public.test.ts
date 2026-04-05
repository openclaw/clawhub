/* @vitest-environment node */

import { getAuthUserId } from "@convex-dev/auth/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backfillPackageReleaseScansInternal,
  getPackageReleaseScanBackfillBatchInternal,
  getByName,
  list,
  publishPackage,
  publishPackageForTrustedPublisherInternal,
  publishPackageForUserInternal,
  getVersionByName,
  insertReleaseInternal,
  listPublicPage,
  listPageForViewerInternal,
  listVersions,
  updateReleaseStaticScanInternal,
  softDeletePackageInternal,
  searchForViewerInternal,
  searchPublic,
} from "./packages";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getByNameHandler = (
  getByName as unknown as WrappedHandler<
    { name: string },
    {
      package: { name: string; latestVersion: string | null };
      latestRelease: { version: string } | null;
    } | null
  >
)._handler;
const listHandler = (
  list as unknown as WrappedHandler<
    {
      ownerUserId?: string;
      ownerPublisherId?: string;
      limit?: number;
    },
    Array<{
      name: string;
      pendingReview?: boolean;
      scanStatus?: string;
      latestRelease: { vtStatus: string | null; staticScanStatus: string | null } | null;
    }>
  >
)._handler;
const getVersionByNameHandler = (
  getVersionByName as unknown as WrappedHandler<
    { name: string; version: string },
    { package: { name: string }; version: { version: string } } | null
  >
)._handler;
const listPublicPageHandler = (
  listPublicPage as unknown as WrappedHandler<
    {
      family?: "skill" | "code-plugin" | "bundle-plugin";
      channel?: "official" | "community" | "private";
      isOfficial?: boolean;
      executesCode?: boolean;
      capabilityTag?: string;
      paginationOpts: { cursor: string | null; numItems: number };
    },
    { page: Array<{ name: string }>; isDone: boolean; continueCursor: string }
  >
)._handler;
const listPageForViewerInternalHandler = (
  listPageForViewerInternal as unknown as WrappedHandler<
    {
      family?: "skill" | "code-plugin" | "bundle-plugin";
      channel?: "official" | "community" | "private";
      isOfficial?: boolean;
      executesCode?: boolean;
      capabilityTag?: string;
      viewerUserId?: string;
      paginationOpts: { cursor: string | null; numItems: number };
    },
    { page: Array<{ name: string }>; isDone: boolean; continueCursor: string }
  >
)._handler;
const listVersionsHandler = (
  listVersions as unknown as WrappedHandler<
    {
      name: string;
      paginationOpts: { cursor: string | null; numItems: number };
    },
    { page: Array<{ version: string }>; isDone: boolean; continueCursor: string }
  >
)._handler;
const insertReleaseInternalHandler = (
  insertReleaseInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      ownerUserId: string;
      ownerPublisherId?: string;
      name: string;
      displayName: string;
      family: "skill" | "code-plugin" | "bundle-plugin";
      version: string;
      changelog: string;
      tags: string[];
      summary: string;
      files: Array<{
        path: string;
        size: number;
        storageId: string;
        sha256: string;
        contentType?: string;
      }>;
      integritySha256: string;
      sourceRepo?: string;
      runtimeId?: string;
      channel?: "official" | "community" | "private";
      compatibility?: unknown;
      capabilities?: unknown;
      verification?: unknown;
      staticScan?: unknown;
      extractedPackageJson?: unknown;
      extractedPluginManifest?: unknown;
      normalizedBundleManifest?: unknown;
      source?: unknown;
    },
    unknown
  >
)._handler;
const searchPublicHandler = (
  searchPublic as unknown as WrappedHandler<
    {
      query: string;
      limit?: number;
      family?: "skill" | "code-plugin" | "bundle-plugin";
      channel?: "official" | "community" | "private";
      isOfficial?: boolean;
      executesCode?: boolean;
      capabilityTag?: string;
    },
    Array<{ package: { name: string } }>
  >
)._handler;
const searchForViewerInternalHandler = (
  searchForViewerInternal as unknown as WrappedHandler<
    {
      query: string;
      limit?: number;
      family?: "skill" | "code-plugin" | "bundle-plugin";
      channel?: "official" | "community" | "private";
      isOfficial?: boolean;
      executesCode?: boolean;
      capabilityTag?: string;
      viewerUserId?: string;
    },
    Array<{ package: { name: string } }>
  >
)._handler;
const publishPackageHandler = (
  publishPackage as unknown as WrappedHandler<
    {
      payload: unknown;
    },
    unknown
  >
)._handler;
const publishPackageForUserInternalHandler = (
  publishPackageForUserInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      payload: unknown;
    },
    unknown
  >
)._handler;
const publishPackageForTrustedPublisherInternalHandler = (
  publishPackageForTrustedPublisherInternal as unknown as WrappedHandler<
    {
      publishTokenId: string;
      payload: unknown;
    },
    unknown
  >
)._handler;
const getPackageReleaseScanBackfillBatchInternalHandler = (
  getPackageReleaseScanBackfillBatchInternal as unknown as WrappedHandler<
    {
      cursor?: number;
      batchSize?: number;
      prioritizeRecent?: boolean;
    },
    {
      releases: Array<{
        releaseId: string;
        packageId: string;
        needsVt: boolean;
        needsLlm: boolean;
        needsStatic: boolean;
      }>;
      nextCursor: number;
      done: boolean;
    }
  >
)._handler;
const backfillPackageReleaseScansInternalHandler = (
  backfillPackageReleaseScansInternal as unknown as WrappedHandler<
    {
      cursor?: number;
      batchSize?: number;
      scheduled?: number;
    },
    { scheduled: number; nextCursor: number; done: boolean }
  >
)._handler;
const updateReleaseStaticScanInternalHandler = (
  updateReleaseStaticScanInternal as unknown as WrappedHandler<
    {
      releaseId: string;
      staticScan: {
        status: "clean" | "suspicious" | "malicious";
        reasonCodes: string[];
        findings: Array<{
          code: string;
          severity: string;
          file: string;
          line: number;
          message: string;
          evidence: string;
        }>;
        summary: string;
        engineVersion: string;
        checkedAt: number;
      };
    },
    unknown
  >
)._handler;
const softDeletePackageInternalHandler = (
  softDeletePackageInternal as unknown as WrappedHandler<
    { userId: string; name: string },
    { ok: true; packageId: string; releaseCount: number; alreadyDeleted: boolean }
  >
)._handler;

afterEach(() => {
  vi.mocked(getAuthUserId).mockReset();
  vi.mocked(getAuthUserId).mockResolvedValue(null);
});

function makeDigest(
  name: string,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    _id: `packageSearchDigest:${name}`,
    packageId: `packages:${name}`,
    name,
    normalizedName: name,
    displayName: name,
    family: "code-plugin",
    runtimeId: null,
    channel: "community",
    isOfficial: false,
    summary: `${name} summary`,
    ownerUserId: "users:owner",
    ownerPublisherId: undefined,
    ownerHandle: "owner",
    createdAt: 1,
    updatedAt: 1,
    latestVersion: "1.0.0",
    capabilityTags: [],
    executesCode: false,
    verificationTier: null,
    softDeletedAt: undefined,
    ...overrides,
  };
}

function makePackageDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "packages:demo",
    name: "demo-plugin",
    normalizedName: "demo-plugin",
    displayName: "Demo Plugin",
    family: "code-plugin",
    channel: "community",
    isOfficial: false,
    ownerUserId: "users:owner",
    ownerPublisherId: undefined,
    tags: {},
    latestReleaseId: "packageReleases:demo-1",
    latestVersionSummary: { version: "1.0.0" },
    compatibility: null,
    capabilities: null,
    verification: null,
    scanStatus: "clean",
    stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
    createdAt: 1,
    updatedAt: 1,
    softDeletedAt: undefined,
    ...overrides,
  };
}

function makeReleaseDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: "packageReleases:demo-1",
    packageId: "packages:demo",
    version: "1.0.0",
    createdAt: 1,
    softDeletedAt: undefined,
    ...overrides,
  };
}

function makeDigestCtx(options: {
  pages?: Array<{ page: Array<Record<string, unknown>>; isDone: boolean; continueCursor: string }>;
  capabilityPages?: Array<{
    page: Array<Record<string, unknown>>;
    isDone: boolean;
    continueCursor: string;
  }>;
  exactPackages?: Array<Record<string, unknown>>;
  exactDigests?: Array<Record<string, unknown>>;
  publisherMemberships?: Record<string, "owner" | "admin" | "publisher">;
}) {
  const pageByTable = new Map<
    string,
    Map<
      string | null,
      { page: Array<Record<string, unknown>>; isDone: boolean; continueCursor: string }
    >
  >();
  const indexNames: string[] = [];
  const tableNames: string[] = [];

  const setPages = (
    table: string,
    pages: Array<{ page: Array<Record<string, unknown>>; isDone: boolean; continueCursor: string }>,
  ) => {
    const pageByCursor = new Map<
      string | null,
      { page: Array<Record<string, unknown>>; isDone: boolean; continueCursor: string }
    >();
    let cursor: string | null = null;
    for (const page of pages) {
      pageByCursor.set(cursor, page);
      cursor = page.continueCursor || null;
    }
    pageByTable.set(table, pageByCursor);
  };

  setPages("packageSearchDigest", options.pages ?? []);
  setPages("packageCapabilitySearchDigest", options.capabilityPages ?? []);

  const paginate = vi.fn();
  const paginateForTable = (table: string) =>
    vi.fn(async (args: { cursor: string | null }) => {
      paginate(args);
      return (
        pageByTable.get(table)?.get(args.cursor ?? null) ?? {
          page: [],
          isDone: true,
          continueCursor: "",
        }
      );
    });
  const paginateByTable = new Map<string, ReturnType<typeof vi.fn>>();
  const getPaginate = (table: string) => {
    const existing = paginateByTable.get(table);
    if (existing) return existing;
    const next = paginateForTable(table);
    paginateByTable.set(table, next);
    return next;
  };

  const withIndex = vi.fn((table: string, indexName: string) => {
    indexNames.push(indexName);
    return {
      order: vi.fn(() => ({
        paginate: getPaginate(table),
      })),
    };
  });

  return {
    indexNames,
    tableNames,
    paginate,
    ctx: {
      db: {
        query: vi.fn((table: string) => {
          if (table === "packages") {
            return {
              withIndex: vi.fn(
                (
                  indexName: string,
                  builder?: (q: {
                    eq: (field: string, value: string) => unknown;
                    gte: (field: string, value: string) => unknown;
                    lt: (field: string, value: string) => unknown;
                  }) => unknown,
                ) => {
                  let matchedValue = "";
                  let lowerBound = "";
                  let upperBound = "";
                  const queryBuilder = {
                    eq: (_field: string, value: string) => {
                      matchedValue = value;
                      return queryBuilder;
                    },
                    gte: (_field: string, value: string) => {
                      lowerBound = value;
                      return queryBuilder;
                    },
                    lt: (_field: string, value: string) => {
                      upperBound = value;
                      return queryBuilder;
                    },
                  };
                  builder?.(queryBuilder);
                  if (indexName !== "by_name" && indexName !== "by_runtime_id") {
                    throw new Error(`Unexpected packages index ${indexName}`);
                  }
                  const matches = (options.exactPackages ?? []).filter((pkg) =>
                    indexName === "by_name"
                      ? matchedValue
                        ? String(pkg.normalizedName) === matchedValue
                        : String(pkg.normalizedName) >= lowerBound &&
                          String(pkg.normalizedName) < upperBound
                      : matchedValue
                        ? String(pkg.runtimeId) === matchedValue
                        : String(pkg.runtimeId) >= lowerBound && String(pkg.runtimeId) < upperBound,
                  );
                  return {
                    unique: vi.fn().mockResolvedValue(matches[0] ?? null),
                    take: vi.fn().mockResolvedValue(matches),
                  };
                },
              ),
            };
          }
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(
                (
                  _indexName: string,
                  builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown,
                ) => {
                  let publisherId = "";
                  const queryBuilder = {
                    eq: (field: string, value: string) => {
                      if (field === "publisherId") publisherId = value;
                      return queryBuilder;
                    },
                  };
                  builder?.(queryBuilder);
                  const role = options.publisherMemberships?.[publisherId];
                  return {
                    unique: vi.fn().mockResolvedValue(
                      role
                        ? {
                            _id: `publisherMembers:${publisherId}`,
                            publisherId,
                            userId: "users:member",
                            role,
                          }
                        : null,
                    ),
                  };
                },
              ),
            };
          }
          if (table === "packageSearchDigest") {
            tableNames.push(table);
            return {
              withIndex: (
                indexName: string,
                builder?: (q: {
                  eq: (field: string, value: string | undefined) => unknown;
                  gte: (field: string, value: string) => unknown;
                  lt: (field: string, value: string) => unknown;
                }) => unknown,
              ) => {
                if (indexName === "by_package") {
                  let packageId = "";
                  const queryBuilder = {
                    eq: (field: string, value: string | undefined) => {
                      if (field === "packageId") packageId = value ?? "";
                      return queryBuilder;
                    },
                    gte: () => queryBuilder,
                    lt: () => queryBuilder,
                  };
                  builder?.(queryBuilder);
                  const match = (options.exactDigests ?? []).find(
                    (digest) => digest.packageId === packageId,
                  );
                  return {
                    unique: vi.fn().mockResolvedValue(match ?? null),
                  };
                }
                if (
                  indexName === "by_active_normalized_name" ||
                  indexName === "by_active_runtime_id"
                ) {
                  let lowerBound = "";
                  let upperBound = "";
                  const queryBuilder = {
                    eq: () => queryBuilder,
                    gte: (_field: string, value: string) => {
                      lowerBound = value;
                      return queryBuilder;
                    },
                    lt: (_field: string, value: string) => {
                      upperBound = value;
                      return queryBuilder;
                    },
                  };
                  builder?.(queryBuilder);
                  const matches = (options.exactDigests ?? []).filter((digest) =>
                    indexName === "by_active_normalized_name"
                      ? String(digest.normalizedName) >= lowerBound &&
                        String(digest.normalizedName) < upperBound
                      : String(digest.runtimeId) >= lowerBound &&
                        String(digest.runtimeId) < upperBound,
                  );
                  return {
                    take: vi.fn().mockResolvedValue(matches),
                  };
                }
                return withIndex(table, indexName);
              },
            };
          }
          if (table !== "packageCapabilitySearchDigest") {
            throw new Error(`Unexpected table ${table}`);
          }
          tableNames.push(table);
          return {
            withIndex: (indexName: string) => withIndex(table, indexName),
          };
        }),
      },
    },
  };
}

function makeInsertReleaseCtx(
  existing: Record<string, unknown> | null,
  priorReleases: Array<Record<string, unknown>> = [],
  recordsById: Record<string, Record<string, unknown>> = {},
) {
  const patch = vi.fn();
  const insert = vi.fn().mockResolvedValueOnce("packageReleases:new");
  return {
    patch,
    insert,
    db: {
      get: vi.fn(async (id: string) => {
        if (id in recordsById) return recordsById[id];
        if (id === "users:owner") return { _id: id, role: "user", trustedPublisher: false };
        return null;
      }),
      query: vi.fn((table: string) => {
        if (table === "packages") {
          return {
            withIndex: vi.fn((_indexName: string) => ({
              unique: vi.fn().mockResolvedValue(existing),
            })),
          };
        }
        if (table === "packageReleases") {
          return {
            withIndex: vi.fn((indexName: string) => {
              if (indexName === "by_package") {
                return {
                  collect: vi.fn().mockResolvedValue(priorReleases),
                };
              }
              return {
                unique: vi.fn().mockResolvedValue(null),
              };
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      insert,
      patch,
      replace: vi.fn(),
      delete: vi.fn(),
      normalizeId: vi.fn(),
    },
  };
}

function makePackageCtx(options: {
  pkg?: Record<string, unknown> | null;
  latestRelease?: Record<string, unknown> | null;
  versionRelease?: Record<string, unknown> | null;
  versionsPage?: { page: Array<Record<string, unknown>>; isDone: boolean; continueCursor: string };
  ownerPublisher?: Record<string, unknown> | null;
  viewerMembershipRole?: "owner" | "admin" | "publisher" | null;
}) {
  const pkg = options.pkg ?? makePackageDoc();
  const latestRelease = options.latestRelease ?? makeReleaseDoc();
  const versionRelease = options.versionRelease ?? latestRelease;
  const ownerPublisher = options.ownerPublisher ?? null;
  const versionsPage = options.versionsPage ?? {
    page: [latestRelease].filter(Boolean),
    isDone: true,
    continueCursor: "",
  };

  const releaseIndexNames: string[] = [];
  return {
    releaseIndexNames,
    ctx: {
      db: {
        get: vi.fn(async (id: string) => {
          if (typeof id === "string" && id.startsWith("users:")) {
            return { _id: id, handle: id.split(":").pop() ?? "user" };
          }
          if (ownerPublisher && pkg && id === pkg.ownerPublisherId) return ownerPublisher;
          if (pkg && id === pkg.latestReleaseId) return latestRelease;
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "packages") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(pkg),
              })),
            };
          }
          if (table === "packageReleases") {
            const filteredVersionsPage = {
              ...versionsPage,
              page: versionsPage.page.filter((release) => release.softDeletedAt === undefined),
            };
            return {
              withIndex: vi.fn((indexName: string) => {
                releaseIndexNames.push(indexName);
                if (indexName === "by_package_active_created") {
                  return {
                    order: vi.fn(() => ({
                      paginate: vi.fn().mockResolvedValue(filteredVersionsPage),
                    })),
                  };
                }
                return {
                  unique: vi.fn().mockResolvedValue(versionRelease),
                  filter: vi.fn(() => ({
                    order: vi.fn(() => ({
                      paginate: vi.fn().mockResolvedValue(filteredVersionsPage),
                    })),
                  })),
                  order: vi.fn(() => ({
                    paginate: vi.fn().mockResolvedValue(versionsPage),
                  })),
                };
              }),
            };
          }
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(
                  options.viewerMembershipRole
                    ? {
                        _id: "publisherMembers:1",
                        publisherId: pkg?.ownerPublisherId,
                        userId: "users:member",
                        role: options.viewerMembershipRole,
                      }
                    : null,
                ),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      },
    },
  };
}

function makeSoftDeletePackageCtx(options?: {
  pkg?: Record<string, unknown> | null;
  releases?: Array<Record<string, unknown>>;
  user?: Record<string, unknown> | null;
}) {
  const pkg = options?.pkg ?? makePackageDoc();
  const releases = options?.releases ?? [makeReleaseDoc()];
  const user = options?.user ?? { _id: "users:owner", role: "user" };
  const patch = vi.fn();
  return {
    patch,
    ctx: {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner" || id === "users:moderator") return user;
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "packages") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(pkg),
              })),
            };
          }
          if (table === "packageReleases") {
            return {
              withIndex: vi.fn(() => ({
                collect: vi.fn().mockResolvedValue(releases),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        patch,
        insert: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        normalizeId: vi.fn(),
      },
    },
  };
}

describe("packages public queries", () => {
  it("keeps buffered cursor items aligned across paginated public pages", async () => {
    const { ctx, paginate } = makeDigestCtx({
      pages: [
        {
          page: [
            makeDigest("alpha"),
            makeDigest("bravo"),
            makeDigest("charlie"),
            makeDigest("delta"),
          ],
          isDone: false,
          continueCursor: "cursor:1",
        },
        {
          page: [makeDigest("echo")],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const first = await listPublicPageHandler(ctx, {
      paginationOpts: { cursor: null, numItems: 2 },
    });
    const second = await listPublicPageHandler(ctx, {
      paginationOpts: { cursor: first.continueCursor, numItems: 2 },
    });
    const third = await listPublicPageHandler(ctx, {
      paginationOpts: { cursor: second.continueCursor, numItems: 2 },
    });

    expect(first.page.map((entry) => entry.name)).toEqual(["alpha", "bravo"]);
    expect(second.page.map((entry) => entry.name)).toEqual(["charlie", "delta"]);
    expect(third.page.map((entry) => entry.name)).toEqual(["echo"]);
    expect(paginate).toHaveBeenCalledTimes(3);
  });

  it("returns the buffered final-page tail even when the stored cursor is done", async () => {
    const { ctx } = makeDigestCtx({
      pages: [
        {
          page: Array.from({ length: 26 }, (_, index) => makeDigest(`pkg-${index + 1}`)),
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const first = await listPublicPageHandler(ctx, {
      paginationOpts: { cursor: null, numItems: 25 },
    });
    const second = await listPublicPageHandler(ctx, {
      paginationOpts: { cursor: first.continueCursor, numItems: 25 },
    });

    expect(first.page).toHaveLength(25);
    expect(second.page.map((entry) => entry.name)).toEqual(["pkg-26"]);
    expect(second.isDone).toBe(true);
    expect(second.continueCursor).toBe("");
  });

  it("keeps package page cursors compact even with large summaries", async () => {
    const { ctx } = makeDigestCtx({
      pages: [
        {
          page: [
            makeDigest("alpha", { summary: "a".repeat(8_000) }),
            makeDigest("bravo", { summary: "b".repeat(8_000) }),
            makeDigest("charlie", { summary: "c".repeat(8_000) }),
          ],
          isDone: false,
          continueCursor: "cursor:1",
        },
      ],
    });

    const result = await listPublicPageHandler(ctx, {
      paginationOpts: { cursor: null, numItems: 1 },
    });

    expect(result.page.map((entry) => entry.name)).toEqual(["alpha"]);
    expect(result.continueCursor.length).toBeLessThan(512);
    expect(result.continueCursor).not.toContain("aaaaaaaa");
    expect(result.continueCursor).not.toContain("bravo summary");
  });

  it("excludes private packages from public list pages", async () => {
    const { ctx } = makeDigestCtx({
      pages: [
        {
          page: [makeDigest("secret-plugin", { channel: "private" }), makeDigest("public-plugin")],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await listPublicPageHandler(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page.map((entry) => entry.name)).toEqual(["public-plugin"]);
  });

  it("allows owners to list their private packages", async () => {
    const { ctx } = makeDigestCtx({
      pages: [
        {
          page: [
            makeDigest("secret-plugin", {
              channel: "private",
              ownerUserId: "users:owner",
            }),
            makeDigest("public-plugin"),
          ],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await listPageForViewerInternalHandler(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
      viewerUserId: "users:owner",
    });

    expect(result.page.map((entry) => entry.name)).toEqual(["secret-plugin", "public-plugin"]);
  });

  it("allows owners to filter to only their private packages", async () => {
    const { ctx, indexNames } = makeDigestCtx({
      pages: [
        {
          page: [
            makeDigest("secret-plugin", {
              channel: "private",
              ownerUserId: "users:owner",
            }),
            makeDigest("other-secret", {
              channel: "private",
              ownerUserId: "users:other",
            }),
          ],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await listPageForViewerInternalHandler(ctx, {
      channel: "private",
      paginationOpts: { cursor: null, numItems: 10 },
      viewerUserId: "users:owner",
    });

    expect(result.page.map((entry) => entry.name)).toEqual(["secret-plugin"]);
    expect(indexNames).toEqual(["by_active_channel_updated"]);
  });

  it("allows org collaborators to list their private packages", async () => {
    const { ctx } = makeDigestCtx({
      pages: [
        {
          page: [
            makeDigest("secret-plugin", {
              channel: "private",
              ownerUserId: "users:owner",
              ownerPublisherId: "publishers:org",
            }),
            makeDigest("public-plugin"),
          ],
          isDone: true,
          continueCursor: "",
        },
      ],
      publisherMemberships: {
        "publishers:org": "publisher",
      },
    });

    const result = await listPageForViewerInternalHandler(ctx, {
      paginationOpts: { cursor: null, numItems: 10 },
      viewerUserId: "users:member",
    });

    expect(result.page.map((entry) => entry.name)).toEqual(["secret-plugin", "public-plugin"]);
  });

  it("applies isOfficial filtering even with family and channel set", async () => {
    const { ctx } = makeDigestCtx({
      pages: [
        {
          page: [
            makeDigest("official-demo", {
              family: "code-plugin",
              channel: "community",
              isOfficial: true,
            }),
            makeDigest("community-demo", {
              family: "code-plugin",
              channel: "community",
              isOfficial: false,
            }),
          ],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await listPublicPageHandler(ctx, {
      family: "code-plugin",
      channel: "community",
      isOfficial: true,
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page.map((entry) => entry.name)).toEqual(["official-demo"]);
  });

  it("keeps scanning official-only listings without a family filter", async () => {
    const { ctx } = makeDigestCtx({
      pages: [
        {
          page: [makeDigest("noise-1", { isOfficial: false })],
          isDone: false,
          continueCursor: "cursor:1",
        },
        {
          page: [makeDigest("noise-2", { isOfficial: false })],
          isDone: false,
          continueCursor: "cursor:2",
        },
        {
          page: [makeDigest("noise-3", { isOfficial: false })],
          isDone: false,
          continueCursor: "cursor:3",
        },
        {
          page: [makeDigest("noise-4", { isOfficial: false })],
          isDone: false,
          continueCursor: "cursor:4",
        },
        {
          page: [makeDigest("noise-5", { isOfficial: false })],
          isDone: false,
          continueCursor: "cursor:5",
        },
        {
          page: [makeDigest("official-late", { isOfficial: true, updatedAt: 10 })],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await listPublicPageHandler(ctx, {
      isOfficial: true,
      paginationOpts: { cursor: null, numItems: 1 },
    });

    expect(result.page.map((entry) => entry.name)).toEqual(["official-late"]);
  });

  it("filters private packages and capability flags in public search", async () => {
    const { ctx } = makeDigestCtx({
      capabilityPages: [
        {
          page: [
            makeDigest("secret-tools", {
              channel: "private",
              executesCode: true,
              capabilityTags: ["tools"],
              capabilityTag: "tools",
            }),
            makeDigest("tools-demo", {
              executesCode: true,
              capabilityTags: ["tools"],
              capabilityTag: "tools",
            }),
          ],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await searchPublicHandler(ctx, {
      query: "demo",
      executesCode: true,
      capabilityTag: "tools",
      limit: 10,
    });

    expect(result.map((entry) => entry.package.name)).toEqual(["tools-demo"]);
  });

  it("allows owners to search their private packages", async () => {
    const { ctx } = makeDigestCtx({
      capabilityPages: [
        {
          page: [
            makeDigest("secret-tools", {
              channel: "private",
              ownerUserId: "users:owner",
              executesCode: true,
              capabilityTags: ["tools"],
              capabilityTag: "tools",
            }),
            makeDigest("other-secret-tools", {
              channel: "private",
              ownerUserId: "users:other",
              executesCode: true,
              capabilityTags: ["tools"],
              capabilityTag: "tools",
            }),
          ],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await searchForViewerInternalHandler(ctx, {
      query: "secret",
      executesCode: true,
      capabilityTag: "tools",
      channel: "private",
      limit: 10,
      viewerUserId: "users:owner",
    });

    expect(result.map((entry) => entry.package.name)).toEqual(["secret-tools"]);
  });

  it("allows org collaborators to search their private packages", async () => {
    const { ctx } = makeDigestCtx({
      capabilityPages: [
        {
          page: [
            makeDigest("secret-tools", {
              channel: "private",
              ownerUserId: "users:owner",
              ownerPublisherId: "publishers:org",
              executesCode: true,
              capabilityTags: ["tools"],
              capabilityTag: "tools",
            }),
            makeDigest("other-secret-tools", {
              channel: "private",
              ownerUserId: "users:other",
              ownerPublisherId: "publishers:other",
              executesCode: true,
              capabilityTags: ["tools"],
              capabilityTag: "tools",
            }),
          ],
          isDone: true,
          continueCursor: "",
        },
      ],
      publisherMemberships: {
        "publishers:org": "publisher",
      },
    });

    const result = await searchForViewerInternalHandler(ctx, {
      query: "secret",
      executesCode: true,
      capabilityTag: "tools",
      channel: "private",
      limit: 10,
      viewerUserId: "users:member",
    });

    expect(result.map((entry) => entry.package.name)).toEqual(["secret-tools"]);
  });

  it("uses the executesCode index for filtered public listings", async () => {
    const { ctx, indexNames, tableNames } = makeDigestCtx({
      pages: [
        {
          page: [makeDigest("exec-demo", { executesCode: true })],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await listPublicPageHandler(ctx, {
      executesCode: true,
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page.map((entry) => entry.name)).toEqual(["exec-demo"]);
    expect(tableNames).toEqual(["packageSearchDigest"]);
    expect(indexNames).toEqual(["by_active_executes_updated"]);
  });

  it("uses capability digests for capability-tagged package search", async () => {
    const { ctx, indexNames, tableNames } = makeDigestCtx({
      capabilityPages: [
        {
          page: [
            makeDigest("tools-demo", {
              capabilityTag: "tools",
              capabilityTags: ["tools"],
              executesCode: true,
            }),
          ],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await searchPublicHandler(ctx, {
      query: "tools",
      capabilityTag: "tools",
      executesCode: true,
      limit: 10,
    });

    expect(result.map((entry) => entry.package.name)).toEqual(["tools-demo"]);
    expect(tableNames).toEqual(["packageCapabilitySearchDigest"]);
    expect(indexNames).toEqual(["by_active_tag_executes_updated"]);
  });

  it("keeps searching beyond the first digest page", async () => {
    const olderMatch = makeDigest("demo-plugin", {
      updatedAt: 10,
    });
    const { ctx } = makeDigestCtx({
      pages: [
        {
          page: Array.from({ length: 200 }, (_, index) =>
            makeDigest(`noise-${index}`, { updatedAt: 5_000 - index }),
          ),
          isDone: false,
          continueCursor: "cursor:1",
        },
        {
          page: [olderMatch],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await searchPublicHandler(ctx, {
      query: "demo-plugin",
      limit: 10,
    });

    expect(result.map((entry) => entry.package.name)).toContain("demo-plugin");
  });

  it("includes exact package-name matches before digest scanning", async () => {
    const exactPkg = makePackageDoc({
      _id: "packages:exact",
      name: "demo-plugin",
      normalizedName: "demo-plugin",
    });
    const exactDigest = makeDigest("demo-plugin", {
      packageId: "packages:exact",
    });
    const { ctx, paginate } = makeDigestCtx({
      pages: [],
      exactPackages: [exactPkg],
      exactDigests: [exactDigest],
    });

    const result = await searchPublicHandler(ctx, {
      query: "demo-plugin",
      limit: 10,
    });

    expect(result.map((entry) => entry.package.name)).toEqual(["demo-plugin"]);
    expect(paginate).toHaveBeenCalledTimes(1);
    expect(ctx.db.query).toHaveBeenCalledWith("packageSearchDigest");
  });

  it("includes exact runtime-id matches before digest scanning", async () => {
    const exactPkg = makePackageDoc({
      _id: "packages:runtime",
      name: "runtime-demo",
      normalizedName: "runtime-demo",
      runtimeId: "demo.plugin",
    });
    const exactDigest = makeDigest("runtime-demo", {
      packageId: "packages:runtime",
      runtimeId: "demo.plugin",
    });
    const { ctx, paginate } = makeDigestCtx({
      pages: [],
      exactPackages: [exactPkg],
      exactDigests: [exactDigest],
    });

    const result = await searchPublicHandler(ctx, {
      query: "demo.plugin",
      limit: 10,
    });

    expect(result.map((entry) => entry.package.name)).toEqual(["runtime-demo"]);
    expect(paginate).toHaveBeenCalledTimes(1);
    expect(ctx.db.query).toHaveBeenCalledWith("packageSearchDigest");
  });

  it("includes prefix package-name matches before digest scanning", async () => {
    const prefixPkg = makePackageDoc({
      _id: "packages:prefix",
      name: "demo-prefix",
      normalizedName: "demo-prefix",
    });
    const prefixDigest = makeDigest("demo-prefix", {
      packageId: "packages:prefix",
    });
    const { ctx, paginate } = makeDigestCtx({
      pages: [],
      exactPackages: [prefixPkg],
      exactDigests: [prefixDigest],
    });

    const result = await searchPublicHandler(ctx, {
      query: "demo",
      limit: 10,
    });

    expect(result.map((entry) => entry.package.name)).toEqual(["demo-prefix"]);
    expect(paginate).toHaveBeenCalledTimes(1);
    expect(ctx.db.query).toHaveBeenCalledWith("packageSearchDigest");
  });

  it("keeps spaced queries on the scan path without throwing", async () => {
    const { ctx } = makeDigestCtx({
      pages: [
        {
          page: [
            makeDigest("demo-plugin", {
              displayName: "Demo Plugin",
            }),
          ],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await searchPublicHandler(ctx, {
      query: "demo plugin",
      limit: 10,
    });

    expect(result.map((entry) => entry.package.name)).toEqual(["demo-plugin"]);
  });

  it("skips publisher membership lookups for public search rows", async () => {
    const { ctx } = makeDigestCtx({
      pages: [
        {
          page: [
            makeDigest("demo-plugin", {
              ownerPublisherId: "publishers:org",
            }),
          ],
          isDone: true,
          continueCursor: "",
        },
      ],
      publisherMemberships: {
        "publishers:org": "publisher",
      },
    });

    const result = await searchForViewerInternalHandler(ctx, {
      query: "demo",
      limit: 10,
      viewerUserId: "users:member",
    });

    expect(result.map((entry) => entry.package.name)).toEqual(["demo-plugin"]);
    expect(ctx.db.query).not.toHaveBeenCalledWith("publisherMembers");
  });

  it("caps public list scans below the Convex read limit budget", async () => {
    const { ctx, paginate } = makeDigestCtx({
      pages: Array.from({ length: 120 }, (_, index) => ({
        page: [makeDigest(`noise-${index}`, { executesCode: false })],
        isDone: false,
        continueCursor: `cursor:${index + 1}`,
      })),
    });

    const result = await listPublicPageHandler(ctx, {
      executesCode: true,
      paginationOpts: { cursor: null, numItems: 100 },
    });

    expect(result.page).toEqual([]);
    expect(paginate).toHaveBeenCalledTimes(100);
  });

  it("caps public search scans below the Convex read limit budget", async () => {
    const { ctx, paginate } = makeDigestCtx({
      pages: Array.from({ length: 170 }, (_, index) => ({
        page: [makeDigest(`noise-${index}`, { executesCode: false, updatedAt: 10_000 - index })],
        isDone: false,
        continueCursor: `cursor:${index + 1}`,
      })),
    });

    const result = await searchPublicHandler(ctx, {
      query: "demo",
      executesCode: true,
      limit: 100,
    });

    expect(result).toEqual([]);
    expect(paginate).toHaveBeenCalledTimes(150);
  });

  it("uses the official index for no-family official search filters", async () => {
    const { ctx, indexNames } = makeDigestCtx({
      pages: [
        {
          page: [makeDigest("official-demo", { isOfficial: true })],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await searchPublicHandler(ctx, {
      query: "official",
      isOfficial: true,
      limit: 10,
    });

    expect(result.map((entry) => entry.package.name)).toEqual(["official-demo"]);
    expect(indexNames).toEqual(["by_active_official_updated"]);
  });

  it("uses the channel index for no-family channel search filters", async () => {
    const { ctx, indexNames } = makeDigestCtx({
      pages: [
        {
          page: [makeDigest("community-demo", { channel: "community" })],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await searchPublicHandler(ctx, {
      query: "community",
      channel: "community",
      limit: 10,
    });

    expect(result.map((entry) => entry.package.name)).toEqual(["community-demo"]);
    expect(indexNames).toEqual(["by_active_channel_updated"]);
  });

  it("uses the combined channel and official index when both filters are set", async () => {
    const { ctx, indexNames } = makeDigestCtx({
      pages: [
        {
          page: [
            makeDigest("official-community-demo", {
              channel: "community",
              isOfficial: true,
            }),
          ],
          isDone: true,
          continueCursor: "",
        },
      ],
    });

    const result = await searchPublicHandler(ctx, {
      query: "official-community",
      channel: "community",
      isOfficial: true,
      limit: 10,
    });

    expect(result.map((entry) => entry.package.name)).toEqual(["official-community-demo"]);
    expect(indexNames).toEqual(["by_active_channel_official_updated"]);
  });

  it("blocks anonymous reads of private packages", async () => {
    const { ctx } = makePackageCtx({
      pkg: makePackageDoc({ channel: "private" }),
    });

    await expect(
      getByNameHandler(ctx, { name: "demo-plugin", viewerUserId: "users:owner" } as never),
    ).resolves.toBeNull();
    await expect(
      listVersionsHandler(ctx, {
        name: "demo-plugin",
        viewerUserId: "users:owner",
        paginationOpts: { cursor: null, numItems: 10 },
      } as never),
    ).resolves.toEqual({
      page: [],
      isDone: true,
      continueCursor: "",
    });
    await expect(
      getVersionByNameHandler(ctx, {
        name: "demo-plugin",
        version: "1.0.0",
        viewerUserId: "users:owner",
      } as never),
    ).resolves.toBeNull();
  });

  it("allows owners to read their private packages", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const { ctx } = makePackageCtx({
      pkg: makePackageDoc({ channel: "private" }),
    });

    const detail = await getByNameHandler(ctx, {
      name: "demo-plugin",
    });
    const version = await getVersionByNameHandler(ctx, {
      name: "demo-plugin",
      version: "1.0.0",
    });

    expect(detail?.package.name).toBe("demo-plugin");
    expect(version?.version.version).toBe("1.0.0");
  });

  it("allows org collaborators to read org-owned private packages", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:member" as never);
    const { ctx } = makePackageCtx({
      pkg: makePackageDoc({
        channel: "private",
        ownerUserId: "users:owner",
        ownerPublisherId: "publishers:org",
      }),
      ownerPublisher: {
        _id: "publishers:org",
        _creationTime: 1,
        kind: "org",
        handle: "acme",
        displayName: "Acme",
        linkedUserId: undefined,
      },
      viewerMembershipRole: "publisher",
    });

    const detail = await getByNameHandler(ctx, {
      name: "demo-plugin",
    });

    expect(detail?.package.name).toBe("demo-plugin");
  });

  it("treats auth resolution failures as anonymous for public package detail", async () => {
    vi.mocked(getAuthUserId).mockRejectedValue(new Error("stale session"));
    const { ctx } = makePackageCtx({
      pkg: makePackageDoc({ channel: "community" }),
    });

    const detail = await getByNameHandler(ctx, {
      name: "demo-plugin",
    });

    expect(detail?.package.name).toBe("demo-plugin");
  });

  it("treats invalid auth user lookups as anonymous for public package detail", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:broken" as never);
    const { ctx } = makePackageCtx({
      pkg: makePackageDoc({ channel: "community" }),
    });
    const get = ctx.db.get as ReturnType<typeof vi.fn>;
    get.mockImplementation(async (id: string) => {
      if (id === "users:broken") throw new Error("Table mismatch");
      if (id === "users:owner") return { _id: id, handle: "owner" };
      if (id === "packageReleases:demo-1") return makeReleaseDoc();
      return null;
    });

    const detail = await getByNameHandler(ctx, {
      name: "demo-plugin",
    });

    expect(detail?.package.name).toBe("demo-plugin");
  });

  it("does not expose a soft-deleted latest release as latestVersion", async () => {
    const { ctx } = makePackageCtx({
      latestRelease: makeReleaseDoc({ softDeletedAt: 10 }),
    });

    const result = await getByNameHandler(ctx, {
      name: "demo-plugin",
    });

    expect(result?.package.latestVersion).toBeNull();
    expect(result?.latestRelease).toBeNull();
  });

  it("hides soft-deleted releases from public version lists", async () => {
    const { ctx, releaseIndexNames } = makePackageCtx({
      versionsPage: {
        page: [
          makeReleaseDoc({ version: "1.1.0", softDeletedAt: 10 }),
          makeReleaseDoc({ _id: "packageReleases:demo-2", version: "1.0.0" }),
        ],
        isDone: true,
        continueCursor: "",
      },
    });

    const result = await listVersionsHandler(ctx, {
      name: "demo-plugin",
      paginationOpts: { cursor: null, numItems: 10 },
    });

    expect(result.page.map((entry) => entry.version)).toEqual(["1.0.0"]);
    expect(releaseIndexNames).toContain("by_package_active_created");
  });

  it("soft-deletes packages and active releases for the owner", async () => {
    const { ctx, patch } = makeSoftDeletePackageCtx({
      releases: [
        makeReleaseDoc(),
        makeReleaseDoc({ _id: "packageReleases:demo-2", version: "1.1.0", softDeletedAt: 123 }),
      ],
    });

    const result = await softDeletePackageInternalHandler(ctx, {
      userId: "users:owner",
      name: "demo-plugin",
    });

    expect(result).toEqual({
      ok: true,
      packageId: "packages:demo",
      releaseCount: 1,
      alreadyDeleted: false,
    });
    expect(patch).toHaveBeenCalledWith("packageReleases:demo-1", {
      softDeletedAt: expect.any(Number),
    });
    expect(patch).toHaveBeenCalledWith(
      "packages:demo",
      expect.objectContaining({
        softDeletedAt: expect.any(Number),
        updatedAt: expect.any(Number),
      }),
    );
  });

  it("rejects non-owner package soft deletes without moderator access", async () => {
    const { ctx } = makeSoftDeletePackageCtx({
      pkg: makePackageDoc({ ownerUserId: "users:someone-else" }),
      user: { _id: "users:owner", role: "user" },
    });

    await expect(
      softDeletePackageInternalHandler(ctx, {
        userId: "users:owner",
        name: "demo-plugin",
      }),
    ).rejects.toThrow("Forbidden");
  });

  it("rejects family changes on an existing package name", async () => {
    const ctx = makeInsertReleaseCtx(makePackageDoc({ family: "bundle-plugin" }));

    await expect(
      insertReleaseInternalHandler(ctx, {
        actorUserId: "users:owner",
        ownerUserId: "users:owner",
        name: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "1.0.0",
        changelog: "init",
        tags: ["latest"],
        summary: "demo",
        files: [],
        integritySha256: "abc123",
      }),
    ).rejects.toThrow("family changes are not allowed");
  });

  it("rejects runtime id changes on an existing code plugin package", async () => {
    const ctx = makeInsertReleaseCtx(makePackageDoc({ runtimeId: "demo.plugin" }));

    await expect(
      insertReleaseInternalHandler(ctx, {
        actorUserId: "users:owner",
        ownerUserId: "users:owner",
        name: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "1.0.1",
        changelog: "retarget runtime id",
        tags: ["latest"],
        summary: "demo",
        files: [],
        integritySha256: "abc123",
        runtimeId: "other.plugin",
      }),
    ).rejects.toThrow("runtime id changes are not allowed");
  });

  it("promotes existing packages to official when publisher becomes trusted", async () => {
    const ctx = makeInsertReleaseCtx(
      makePackageDoc({
        channel: "community",
        isOfficial: false,
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      }),
    );
    ctx.db.get.mockImplementation(async (id: string) => {
      if (id === "users:owner") return { _id: id, trustedPublisher: true };
      return null;
    });

    await insertReleaseInternalHandler(ctx, {
      actorUserId: "users:owner",
      ownerUserId: "users:owner",
      name: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      version: "1.1.0",
      changelog: "promote",
      tags: ["latest"],
      summary: "demo",
      files: [],
      integritySha256: "abc123",
      capabilities: { capabilityTags: ["tools"], executesCode: true },
    });

    expect(ctx.patch).toHaveBeenCalledWith(
      "packages:demo",
      expect.objectContaining({
        channel: "official",
        isOfficial: true,
      }),
    );
  });

  it("lets admins publish package releases on behalf of another owner", async () => {
    const ctx = makeInsertReleaseCtx(
      makePackageDoc({
        ownerUserId: "users:openclaw",
        channel: "official",
        isOfficial: true,
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      }),
      [],
      {
        "users:admin": { _id: "users:admin", role: "admin", trustedPublisher: false },
        "users:openclaw": { _id: "users:openclaw", role: "user", trustedPublisher: true },
      },
    );

    await insertReleaseInternalHandler(ctx, {
      actorUserId: "users:admin",
      ownerUserId: "users:openclaw",
      name: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      version: "1.1.0",
      changelog: "promote",
      tags: ["latest"],
      summary: "demo",
      files: [],
      integritySha256: "abc123",
      channel: "official",
    });

    expect(ctx.insert).toHaveBeenCalledWith(
      "packageReleases",
      expect.objectContaining({
        createdBy: "users:admin",
      }),
    );
  });

  it("rejects non-admin publishes on behalf of another owner", async () => {
    const ctx = makeInsertReleaseCtx(
      makePackageDoc({
        ownerUserId: "users:openclaw",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      }),
      [],
      {
        "users:owner": { _id: "users:owner", role: "user", trustedPublisher: false },
        "users:openclaw": { _id: "users:openclaw", role: "user", trustedPublisher: true },
      },
    );

    await expect(
      insertReleaseInternalHandler(ctx, {
        actorUserId: "users:owner",
        ownerUserId: "users:openclaw",
        name: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "1.1.0",
        changelog: "promote",
        tags: ["latest"],
        summary: "demo",
        files: [],
        integritySha256: "abc123",
      }),
    ).rejects.toThrow("Forbidden");
  });

  it("rejects publishing the same package name across different publishers", async () => {
    const ctx = makeInsertReleaseCtx(
      makePackageDoc({
        ownerUserId: "users:owner",
        ownerPublisherId: undefined,
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      }),
      [],
      {
        "users:owner": { _id: "users:owner", role: "user", trustedPublisher: false },
        "publishers:org": {
          _id: "publishers:org",
          kind: "org",
          handle: "acme",
          displayName: "Acme",
          trustedPublisher: false,
        },
      },
    );

    await expect(
      insertReleaseInternalHandler(ctx, {
        actorUserId: "users:owner",
        ownerUserId: "users:owner",
        ownerPublisherId: "publishers:org",
        name: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "1.1.0",
        changelog: "org release",
        tags: ["latest"],
        summary: "demo",
        files: [],
        integritySha256: "abc123",
      }),
    ).rejects.toThrow("Package already exists and belongs to another publisher");
  });

  it("treats a legacy personal package as the same personal publisher", async () => {
    const ctx = makeInsertReleaseCtx(
      makePackageDoc({
        ownerUserId: "users:owner",
        ownerPublisherId: undefined,
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      }),
      [],
      {
        "users:owner": { _id: "users:owner", role: "user", trustedPublisher: false },
        "publishers:owner": {
          _id: "publishers:owner",
          kind: "user",
          handle: "owner",
          displayName: "Owner",
          linkedUserId: "users:owner",
          trustedPublisher: false,
        },
      },
    );

    await expect(
      insertReleaseInternalHandler(ctx, {
        actorUserId: "users:owner",
        ownerUserId: "users:owner",
        ownerPublisherId: "publishers:owner",
        name: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "1.1.0",
        changelog: "personal release",
        tags: ["latest"],
        summary: "demo",
        files: [],
        integritySha256: "abc123",
      }),
    ).resolves.toMatchObject({ ok: true, packageId: "packages:demo" });

    expect(ctx.patch).toHaveBeenCalledWith(
      "packages:demo",
      expect.objectContaining({
        ownerUserId: "users:owner",
        ownerPublisherId: "publishers:owner",
      }),
    );
  });

  it("does not overwrite capability search fields for non-latest releases", async () => {
    const ctx = makeInsertReleaseCtx(
      makePackageDoc({
        capabilityTags: ["channel:chat"],
        executesCode: true,
        tags: { latest: "packageReleases:demo-1" },
        latestReleaseId: "packageReleases:demo-1",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      }),
    );

    await insertReleaseInternalHandler(ctx, {
      actorUserId: "users:owner",
      ownerUserId: "users:owner",
      name: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      version: "0.9.9",
      changelog: "branch patch",
      tags: ["legacy"],
      summary: "demo",
      files: [],
      integritySha256: "abc123",
      capabilities: { capabilityTags: ["legacy"], executesCode: false },
    });

    expect(ctx.patch).toHaveBeenCalledWith(
      "packages:demo",
      expect.objectContaining({
        capabilityTags: ["channel:chat"],
        executesCode: true,
      }),
    );
  });

  it("keeps package summary pinned to the promoted release for non-latest publishes", async () => {
    const ctx = makeInsertReleaseCtx(
      makePackageDoc({
        summary: "latest summary",
        tags: { latest: "packageReleases:demo-1" },
        latestReleaseId: "packageReleases:demo-1",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      }),
    );

    await insertReleaseInternalHandler(ctx, {
      actorUserId: "users:owner",
      ownerUserId: "users:owner",
      name: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      version: "0.9.9",
      changelog: "branch patch",
      tags: ["legacy"],
      summary: "legacy branch summary",
      files: [],
      integritySha256: "abc123",
    });

    expect(ctx.patch).toHaveBeenCalledWith(
      "packages:demo",
      expect.objectContaining({
        summary: "latest summary",
      }),
    );
  });

  it("keeps runtimeId pinned to the promoted release for non-latest publishes", async () => {
    const ctx = makeInsertReleaseCtx(
      makePackageDoc({
        family: "bundle-plugin",
        runtimeId: "bundle.current",
        tags: { latest: "packageReleases:demo-1" },
        latestReleaseId: "packageReleases:demo-1",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      }),
    );

    await insertReleaseInternalHandler(ctx, {
      actorUserId: "users:owner",
      ownerUserId: "users:owner",
      name: "demo-plugin",
      displayName: "Demo Plugin",
      family: "bundle-plugin",
      version: "0.9.9",
      changelog: "legacy branch",
      tags: ["legacy"],
      summary: "legacy summary",
      files: [],
      integritySha256: "abc123",
      runtimeId: "bundle.legacy",
    });

    expect(ctx.patch).toHaveBeenCalledWith(
      "packages:demo",
      expect.objectContaining({
        runtimeId: "bundle.current",
      }),
    );
  });

  it("removes moved dist-tags from older package releases", async () => {
    const olderRelease = makeReleaseDoc({
      _id: "packageReleases:old",
      version: "1.0.0",
      distTags: ["latest", "stable"],
    });
    const ctx = makeInsertReleaseCtx(
      makePackageDoc({
        tags: { latest: "packageReleases:old", stable: "packageReleases:old" },
        latestReleaseId: "packageReleases:old",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      }),
      [olderRelease],
    );

    await insertReleaseInternalHandler(ctx, {
      actorUserId: "users:owner",
      ownerUserId: "users:owner",
      name: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      version: "1.1.0",
      changelog: "promote",
      tags: ["latest"],
      summary: "demo",
      files: [],
      integritySha256: "abc123",
    });

    expect(ctx.patch).toHaveBeenCalledWith("packageReleases:old", {
      distTags: ["stable"],
    });
  });

  it("adds a latest tag when an untagged promoted release becomes the package latest", async () => {
    const ctx = makeInsertReleaseCtx(
      makePackageDoc({
        latestReleaseId: undefined,
        latestVersionSummary: undefined,
        tags: {},
        stats: { downloads: 0, installs: 0, stars: 0, versions: 0 },
      }),
    );

    await insertReleaseInternalHandler(ctx, {
      actorUserId: "users:owner",
      ownerUserId: "users:owner",
      name: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      version: "1.0.0",
      changelog: "beta",
      tags: ["beta"],
      summary: "demo",
      files: [],
      integritySha256: "abc123",
      verification: {
        tier: "source-linked",
        scope: "artifact-only",
        scanStatus: "suspicious",
      },
      staticScan: {
        status: "suspicious",
        reasonCodes: ["suspicious.dynamic_code_execution"],
        findings: [],
        summary: "Detected: suspicious.dynamic_code_execution",
        engineVersion: "test",
        checkedAt: 123,
      },
    });

    expect(ctx.insert).toHaveBeenCalledWith(
      "packageReleases",
      expect.objectContaining({
        distTags: ["beta", "latest"],
        verification: expect.objectContaining({ scanStatus: "suspicious" }),
        staticScan: expect.objectContaining({ status: "suspicious" }),
      }),
    );
    expect(ctx.patch).toHaveBeenCalledWith(
      "packages:demo",
      expect.objectContaining({
        latestReleaseId: "packageReleases:new",
        tags: { beta: "packageReleases:new", latest: "packageReleases:new" },
      }),
    );
  });

  it("validates package publish payloads inside the action path", async () => {
    await expect(
      publishPackageForUserInternalHandler({} as never, {
        actorUserId: "users:owner",
        payload: {
          name: "demo-plugin",
          family: "bundle-plugin",
          version: "1.0.0",
          changelog: "init",
          bundle: { hostTargets: ["desktop"] },
          files: "invalid",
        },
      }),
    ).rejects.toThrow(/Package publish payload/i);
  });

  it("rejects skill publishes on the package endpoint", async () => {
    await expect(
      publishPackageForUserInternalHandler({} as never, {
        actorUserId: "users:owner",
        payload: {
          name: "demo-skill",
          family: "skill",
          version: "1.0.0",
          changelog: "init",
          files: [],
        },
      }),
    ).rejects.toThrow("Skill packages must use the skills publish flow");
  });

  it("rejects trusted publish tokens after trusted publisher rotation or deletion", async () => {
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "packagePublishTokens:1",
          packageId: "packages:demo",
          provider: "github-actions",
          repository: "openclaw/openclaw",
          repositoryId: "1",
          repositoryOwner: "openclaw",
          repositoryOwnerId: "2",
          workflowFilename: "plugin-clawhub-release.yml",
          environment: "clawhub-release",
          version: "1.0.0",
          sha: "abc123",
          ref: "refs/heads/main",
          runId: "100",
          runAttempt: "1",
          expiresAt: Date.now() + 60_000,
        })
        .mockResolvedValueOnce(null),
    };

    await expect(
      publishPackageForTrustedPublisherInternalHandler(ctx as never, {
        publishTokenId: "packagePublishTokens:1",
        payload: {
          name: "demo-plugin",
          family: "bundle-plugin",
          version: "1.0.0",
          changelog: "init",
          bundle: { hostTargets: ["desktop"] },
          files: [],
        },
      }),
    ).rejects.toThrow(
      "Trusted publish token no longer matches the current package trusted publisher",
    );
  });

  it("revokes trusted publish tokens after a successful publish", async () => {
    const runMutation = vi.fn(async (_ref: unknown, args: unknown) => {
      if (
        typeof args === "object" &&
        args !== null &&
        "name" in args &&
        "version" in args &&
        "files" in args
      ) {
        return {
          ok: true,
          packageId: "packages:demo",
          releaseId: "packageReleases:demo-2",
        };
      }
      return null;
    });
    const trustedPublisher = {
      _id: "packageTrustedPublishers:1",
      packageId: "packages:demo",
      provider: "github-actions",
      repository: "openclaw/openclaw",
      repositoryId: "1",
      repositoryOwner: "openclaw",
      repositoryOwnerId: "2",
      workflowFilename: "plugin-clawhub-release.yml",
      environment: "clawhub-release",
    };
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "packagePublishTokens:1",
          packageId: "packages:demo",
          provider: "github-actions",
          repository: "openclaw/openclaw",
          repositoryId: "1",
          repositoryOwner: "openclaw",
          repositoryOwnerId: "2",
          workflowFilename: "plugin-clawhub-release.yml",
          environment: "clawhub-release",
          version: "1.0.0",
          sha: "abc123",
          ref: "refs/heads/main",
          runId: "100",
          runAttempt: "1",
          expiresAt: Date.now() + 60_000,
        })
        .mockResolvedValueOnce(trustedPublisher)
        .mockResolvedValueOnce(makePackageDoc({ family: "bundle-plugin" }))
        .mockResolvedValueOnce(trustedPublisher)
        .mockResolvedValueOnce(null),
      runMutation,
      scheduler: {
        runAfter: vi.fn(),
      },
      storage: {
        get: vi.fn(),
      },
    };

    await expect(
      publishPackageForTrustedPublisherInternalHandler(ctx as never, {
        publishTokenId: "packagePublishTokens:1",
        payload: {
          name: "demo-plugin",
          family: "bundle-plugin",
          version: "1.0.0",
          changelog: "init",
          bundle: { hostTargets: ["desktop"] },
          files: [],
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      packageId: "packages:demo",
      releaseId: "packageReleases:demo-2",
    });

    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      tokenId: "packagePublishTokens:1",
    });
  });

  it("accepts trusted publish tokens when no environment is pinned", async () => {
    const runMutation = vi.fn(async (_ref: unknown, args: unknown) => {
      if (
        typeof args === "object" &&
        args !== null &&
        "name" in args &&
        "version" in args &&
        "files" in args
      ) {
        return {
          ok: true,
          packageId: "packages:demo",
          releaseId: "packageReleases:demo-2",
        };
      }
      return null;
    });
    const trustedPublisher = {
      _id: "packageTrustedPublishers:1",
      packageId: "packages:demo",
      provider: "github-actions",
      repository: "openclaw/openclaw",
      repositoryId: "1",
      repositoryOwner: "openclaw",
      repositoryOwnerId: "2",
      workflowFilename: "plugin-clawhub-release.yml",
    };
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce({
          _id: "packagePublishTokens:1",
          packageId: "packages:demo",
          provider: "github-actions",
          repository: "openclaw/openclaw",
          repositoryId: "1",
          repositoryOwner: "openclaw",
          repositoryOwnerId: "2",
          workflowFilename: "plugin-clawhub-release.yml",
          version: "1.0.0",
          sha: "abc123",
          ref: "refs/heads/main",
          runId: "100",
          runAttempt: "1",
          expiresAt: Date.now() + 60_000,
        })
        .mockResolvedValueOnce(trustedPublisher)
        .mockResolvedValueOnce(makePackageDoc({ family: "bundle-plugin" }))
        .mockResolvedValueOnce(trustedPublisher)
        .mockResolvedValueOnce(null),
      runMutation,
      scheduler: {
        runAfter: vi.fn(),
      },
      storage: {
        get: vi.fn(),
      },
    };

    await expect(
      publishPackageForTrustedPublisherInternalHandler(ctx as never, {
        publishTokenId: "packagePublishTokens:1",
        payload: {
          name: "demo-plugin",
          family: "bundle-plugin",
          version: "1.0.0",
          changelog: "init",
          bundle: { hostTargets: ["desktop"] },
          files: [],
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      packageId: "packages:demo",
      releaseId: "packageReleases:demo-2",
    });
  });

  it("requires manual override for user-auth publishes when trusted publisher config exists", async () => {
    const runMutation = vi.fn(async (_ref: unknown, args: unknown) => {
      if (
        typeof args === "object" &&
        args !== null &&
        "actorUserId" in args &&
        "minimumRole" in args
      ) {
        return null;
      }
      if (
        typeof args === "object" &&
        args !== null &&
        "name" in args &&
        "version" in args &&
        "files" in args
      ) {
        return {
          ok: true,
          packageId: "packages:demo",
          releaseId: "packageReleases:demo-2",
        };
      }
      return null;
    });
    const trustedPublisher = {
      _id: "packageTrustedPublishers:1",
      packageId: "packages:demo",
      provider: "github-actions",
      repository: "openclaw/openclaw",
      repositoryId: "1",
      repositoryOwner: "openclaw",
      repositoryOwnerId: "2",
      workflowFilename: "plugin-clawhub-release.yml",
      environment: "clawhub-release",
    };
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce(makePackageDoc({ family: "bundle-plugin" }))
        .mockResolvedValueOnce(trustedPublisher)
        .mockResolvedValueOnce({
          _id: "users:owner",
          githubCreatedAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
        })
        .mockResolvedValueOnce(null),
      runMutation,
      scheduler: {
        runAfter: vi.fn(),
      },
      storage: {
        get: vi.fn(),
      },
    };

    await expect(
      publishPackageForUserInternalHandler(ctx as never, {
        actorUserId: "users:owner",
        payload: {
          name: "demo-plugin",
          family: "bundle-plugin",
          version: "1.0.0",
          changelog: "tag publish",
          bundle: { hostTargets: ["desktop"] },
          source: {
            kind: "github",
            url: "https://github.com/openclaw/openclaw",
            repo: "openclaw/openclaw",
            ref: "refs/tags/plugins-2026.4.1-beta.1",
            commit: "abc123",
            path: "extensions/discord",
            importedAt: Date.now(),
          },
          files: [],
        },
      }),
    ).rejects.toThrow(
      "Manual publishes for packages with trusted publisher config require manualOverrideReason",
    );
  });

  it("scans plugin publishes and forwards scan status to insertReleaseInternal", async () => {
    const runMutation = vi.fn(async (_ref: unknown, args: unknown) => args);
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          _id: "users:owner",
          githubCreatedAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
        })
        .mockResolvedValueOnce(null),
      runMutation,
      scheduler: {
        runAfter: vi.fn(),
      },
      storage: {
        get: vi.fn(async (storageId: string) => {
          const files = new Map<string, string>([
            [
              "storage:package",
              JSON.stringify({
                name: "demo-plugin",
                openclaw: {
                  extensions: ["./dist/index.js"],
                  compat: { pluginApi: "^1.0.0" },
                  build: { openclawVersion: "2026.3.14" },
                  configSchema: { type: "object" },
                },
              }),
            ],
            [
              "storage:manifest",
              JSON.stringify({ id: "demo.plugin", tools: [{ name: "demoTool" }] }),
            ],
            [
              "storage:code",
              "import { execSync } from 'node:child_process';\nexecSync('curl http://x');\n",
            ],
          ]);
          const content = files.get(storageId);
          return content ? new Blob([content]) : null;
        }),
      },
    };

    const result = (await publishPackageForUserInternalHandler(ctx as never, {
      actorUserId: "users:owner",
      payload: {
        name: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
        version: "1.0.0",
        changelog: "init",
        source: {
          kind: "github",
          url: "https://github.com/openclaw/demo-plugin",
          repo: "openclaw/demo-plugin",
          ref: "refs/tags/v1.0.0",
          commit: "abc123",
          path: ".",
          importedAt: Date.now(),
        },
        files: [
          {
            path: "package.json",
            size: 1,
            storageId: "storage:package",
            sha256: "package",
            contentType: "application/json",
          },
          {
            path: "openclaw.plugin.json",
            size: 1,
            storageId: "storage:manifest",
            sha256: "manifest",
            contentType: "application/json",
          },
          {
            path: "dist/index.js",
            size: 1,
            storageId: "storage:code",
            sha256: "code",
            contentType: "application/javascript",
          },
        ],
      },
    })) as Record<string, unknown>;

    expect(runMutation).toHaveBeenCalled();
    expect(result.verification).toEqual(expect.objectContaining({ scanStatus: "pending" }));
    expect(result.staticScan).toEqual(
      expect.objectContaining({
        status: "suspicious",
        reasonCodes: expect.arrayContaining(["suspicious.dangerous_exec"]),
      }),
    );
    expect(ctx.scheduler.runAfter).toHaveBeenNthCalledWith(
      1,
      30_000,
      expect.anything(),
      expect.any(Object),
    );
  });

  it("keeps pending-scan packages visible to public reads", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue(null);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "packageReleases:demo-1") return makeReleaseDoc({ version: "1.0.0" });
          if (id === "users:owner") return { _id: "users:owner", handle: "owner" };
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table !== "packages") throw new Error(`Unexpected table ${table}`);
          return {
            withIndex: vi.fn(() => ({
              unique: vi.fn().mockResolvedValue(makePackageDoc({ scanStatus: "pending" })),
            })),
          };
        }),
      },
    };

    const result = await getByNameHandler(ctx as never, { name: "demo-plugin" });
    expect(result?.package?.name).toBe("demo-plugin");
  });

  it("keeps pending-scan packages visible to the owner", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const result = await getByNameHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "packageReleases:demo-1") return makeReleaseDoc({ version: "1.0.0" });
            if (id === "users:owner") return { _id: "users:owner", handle: "owner" };
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table !== "packages") throw new Error(`Unexpected table ${table}`);
            return {
              withIndex: vi.fn(() => ({
                unique: vi
                  .fn()
                  .mockResolvedValue(
                    makePackageDoc({ ownerUserId: "users:owner", scanStatus: "pending" }),
                  ),
              })),
            };
          }),
        },
      } as never,
      { name: "demo-plugin" },
    );

    expect(result?.package?.name).toBe("demo-plugin");
  });

  it("lists owner packages with pending review and latest release scan state", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const result = await listHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "packageReleases:demo-1") {
              return makeReleaseDoc({
                version: "1.0.0",
                vtAnalysis: { status: "pending" },
                llmAnalysis: { status: "clean" },
                staticScan: { status: "clean" },
              });
            }
            if (id === "users:owner") {
              return { _id: "users:owner", handle: "owner" };
            }
            if (id === "publishers:owner") {
              return { _id: "publishers:owner", kind: "user", linkedUserId: "users:owner" };
            }
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "packages") {
              return {
                withIndex: vi.fn((indexName: string) => {
                  if (indexName === "by_owner_publisher") {
                    return {
                      order: vi.fn(() => ({
                        take: vi.fn().mockResolvedValue([
                          makePackageDoc({
                            ownerPublisherId: "publishers:owner",
                            scanStatus: "pending",
                          }),
                        ]),
                      })),
                    };
                  }
                  if (indexName === "by_owner") {
                    return {
                      order: vi.fn(() => ({
                        take: vi.fn().mockResolvedValue([]),
                      })),
                    };
                  }
                  throw new Error(`Unexpected index ${indexName}`);
                }),
              };
            }
            if (table === "publisherMembers") {
              return {
                withIndex: vi.fn(() => ({
                  unique: vi.fn().mockResolvedValue(null),
                })),
              };
            }
            throw new Error(`Unexpected table ${table}`);
          }),
        },
      } as never,
      { ownerPublisherId: "publishers:owner", limit: 20 },
    );

    expect(result).toEqual([
      expect.objectContaining({
        name: "demo-plugin",
        pendingReview: true,
        scanStatus: "pending",
        latestRelease: expect.objectContaining({
          vtStatus: "pending",
          staticScanStatus: "clean",
        }),
      }),
    ]);
  });

  it("returns no owner packages when the viewer lacks access", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:stranger" as never);
    const result = await listHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "publishers:owner") {
              return { _id: "publishers:owner", kind: "user", linkedUserId: "users:owner" };
            }
            return null;
          }),
          query: vi.fn((table: string) => {
            if (table === "publisherMembers") {
              return {
                withIndex: vi.fn(() => ({
                  unique: vi.fn().mockResolvedValue(null),
                })),
              };
            }
            throw new Error(`Unexpected table ${table}`);
          }),
        },
      } as never,
      { ownerPublisherId: "publishers:owner", limit: 20 },
    );

    expect(result).toEqual([]);
  });

  it("requires auth inside the public publish action", async () => {
    await expect(
      publishPackageHandler({ runQuery: vi.fn(), runMutation: vi.fn() } as never, {
        payload: {
          name: "demo-plugin",
          family: "bundle-plugin",
          version: "1.0.0",
          changelog: "init",
          files: [],
        },
      }),
    ).rejects.toThrow("Unauthorized");
  });
});

describe("package scan backfill", () => {
  it("includes releases missing static scan in the backfill batch", async () => {
    const result = await getPackageReleaseScanBackfillBatchInternalHandler(
      {
        db: {
          query: vi.fn((table: string) => {
            if (table !== "packageReleases") throw new Error(`Unexpected table ${table}`);
            return {
              order: vi.fn(() => ({
                take: vi.fn().mockResolvedValue([]),
              })),
              withIndex: vi.fn(() => ({
                order: vi.fn(() => ({
                  take: vi.fn().mockResolvedValue([
                    {
                      _id: "packageReleases:missing-static",
                      _creationTime: 10,
                      packageId: "packages:demo",
                      sha256hash: "hash",
                      vtAnalysis: { status: "clean" },
                      llmAnalysis: { status: "clean" },
                      staticScan: undefined,
                    },
                    {
                      _id: "packageReleases:fully-scanned",
                      _creationTime: 11,
                      packageId: "packages:demo",
                      sha256hash: "hash",
                      vtAnalysis: { status: "clean" },
                      llmAnalysis: { status: "clean" },
                      staticScan: { status: "clean" },
                    },
                  ]),
                })),
              })),
            };
          }),
          get: vi.fn(async (id: string) => {
            if (id === "packages:demo") return makePackageDoc();
            return null;
          }),
        },
      } as never,
      { batchSize: 10 },
    );

    expect(result.releases).toEqual([
      {
        releaseId: "packageReleases:missing-static",
        packageId: "packages:demo",
        needsVt: false,
        needsLlm: false,
        needsStatic: true,
      },
    ]);
  });

  it("prioritizes recent releases before draining older backlog", async () => {
    const result = await getPackageReleaseScanBackfillBatchInternalHandler(
      {
        db: {
          query: vi.fn((table: string) => {
            if (table !== "packageReleases") throw new Error(`Unexpected table ${table}`);
            return {
              order: vi.fn(() => ({
                take: vi.fn().mockResolvedValue([
                  {
                    _id: "packageReleases:recent-vt",
                    _creationTime: 200,
                    packageId: "packages:demo",
                    sha256hash: "hash",
                    vtAnalysis: undefined,
                    llmAnalysis: { status: "clean" },
                    staticScan: { status: "clean" },
                  },
                ]),
              })),
              withIndex: vi.fn(() => ({
                order: vi.fn(() => ({
                  take: vi.fn().mockResolvedValue([
                    {
                      _id: "packageReleases:old-static",
                      _creationTime: 10,
                      packageId: "packages:demo",
                      sha256hash: "hash",
                      vtAnalysis: { status: "clean" },
                      llmAnalysis: { status: "clean" },
                      staticScan: undefined,
                    },
                  ]),
                })),
              })),
            };
          }),
          get: vi.fn(async (id: string) => {
            if (id === "packages:demo") return makePackageDoc();
            return null;
          }),
        },
      } as never,
      { batchSize: 2, prioritizeRecent: true },
    );

    expect(result.releases).toEqual([
      {
        releaseId: "packageReleases:recent-vt",
        packageId: "packages:demo",
        needsVt: true,
        needsLlm: false,
        needsStatic: false,
      },
      {
        releaseId: "packageReleases:old-static",
        packageId: "packages:demo",
        needsVt: false,
        needsLlm: false,
        needsStatic: true,
      },
    ]);
  });

  it("schedules static rescans for releases missing only static scan data", async () => {
    const originalVtApiKey = process.env.VT_API_KEY;
    process.env.VT_API_KEY = "vt-test-key";

    try {
      const runAfter = vi.fn().mockResolvedValue(undefined);
      const result = await backfillPackageReleaseScansInternalHandler(
        {
          runQuery: vi.fn().mockResolvedValue({
            releases: [
              {
                releaseId: "packageReleases:static-only",
                needsVt: false,
                needsLlm: false,
                needsStatic: true,
              },
            ],
            nextCursor: 123,
            done: true,
          }),
          scheduler: { runAfter },
        } as never,
        { batchSize: 10 },
      );

      expect(result).toEqual({ scheduled: 1, nextCursor: 123, done: true });
      expect(runAfter).toHaveBeenCalledTimes(1);
      expect(runAfter).toHaveBeenCalledWith(
        0,
        expect.anything(),
        expect.objectContaining({ releaseId: "packageReleases:static-only" }),
      );
    } finally {
      if (originalVtApiKey === undefined) {
        delete process.env.VT_API_KEY;
      } else {
        process.env.VT_API_KEY = originalVtApiKey;
      }
    }
  });

  it("promotes latest package scan status when a static rescan finds malware", async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    const release = {
      _id: "packageReleases:demo-1",
      packageId: "packages:demo",
      verification: {
        tier: "source-linked",
        scope: "artifact-only",
        scanStatus: "pending",
      },
      softDeletedAt: undefined,
    };
    const pkg = {
      ...makePackageDoc(),
      _id: "packages:demo",
      latestReleaseId: "packageReleases:demo-1",
      verification: {
        tier: "source-linked",
        scope: "artifact-only",
        scanStatus: "pending",
      },
      latestVersionSummary: {
        version: "1.0.0",
        verification: {
          tier: "source-linked",
          scope: "artifact-only",
          scanStatus: "pending",
        },
      },
    };

    await updateReleaseStaticScanInternalHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "packageReleases:demo-1") return release;
            if (id === "packages:demo") return pkg;
            return null;
          }),
          query: vi.fn(),
          insert: vi.fn(),
          patch,
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
        },
      } as never,
      {
        releaseId: "packageReleases:demo-1",
        staticScan: {
          status: "malicious",
          reasonCodes: ["malware.test"],
          findings: [],
          summary: "Malware detected",
          engineVersion: "test",
          checkedAt: 1,
        },
      },
    );

    expect(patch).toHaveBeenNthCalledWith(
      1,
      "packageReleases:demo-1",
      expect.objectContaining({
        staticScan: expect.objectContaining({ status: "malicious" }),
        verification: expect.objectContaining({ scanStatus: "malicious" }),
      }),
    );
    expect(patch).toHaveBeenNthCalledWith(
      2,
      "packages:demo",
      expect.objectContaining({
        scanStatus: "malicious",
        verification: expect.objectContaining({ scanStatus: "malicious" }),
        latestVersionSummary: expect.objectContaining({
          verification: expect.objectContaining({ scanStatus: "malicious" }),
        }),
      }),
    );
  });
});
