/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("./lib/badges", () => ({
  getSkillBadgeMap: vi.fn(),
  getSkillBadgeMaps: vi.fn(),
  isSkillHighlighted: vi.fn(),
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");
const { getSkillBadgeMap, getSkillBadgeMaps } = await import("./lib/badges");
const { getBySlug, getVersionById, getVersionBySkillAndVersion, listVersions, listWithLatest } =
  await import("./skills");

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getBySlugHandler = (
  getBySlug as unknown as WrappedHandler<{
    slug: string;
  }>
)._handler;

const getVersionByIdHandler = (
  getVersionById as unknown as WrappedHandler<{
    versionId: string;
  }>
)._handler;

const getVersionBySkillAndVersionHandler = (
  getVersionBySkillAndVersion as unknown as WrappedHandler<{
    skillId: string;
    version: string;
  }>
)._handler;

const listVersionsHandler = (
  listVersions as unknown as WrappedHandler<{
    skillId: string;
    limit?: number;
  }>
)._handler;

const listWithLatestHandler = (
  listWithLatest as unknown as WrappedHandler<{
    limit?: number;
  }>
)._handler;

function makeVersion() {
  return {
    _id: "skillVersions:1",
    _creationTime: 1,
    skillId: "skills:1",
    version: "1.0.0",
    fingerprint: "fp",
    changelog: "Initial release",
    changelogSource: "auto",
    files: [
      {
        path: "SKILL.md",
        size: 10,
        storageId: "_storage:1",
        sha256: "abc123",
        contentType: "text/markdown",
      },
    ],
    parsed: {
      frontmatter: { secret: "value" },
      metadata: { hidden: true },
      clawdis: { os: ["macos"] },
      moltbot: { prompt: "hidden" },
      license: "MIT-0",
    },
    createdBy: "users:1",
    createdAt: 100,
    softDeletedAt: undefined,
    sha256hash: "deadbeef",
    vtAnalysis: {
      status: "clean",
      verdict: "clean",
      analysis: "safe",
      source: "code_insight",
      checkedAt: 1,
    },
    llmAnalysis: {
      status: "clean",
      verdict: "benign",
      confidence: "high",
      summary: "Looks safe",
      dimensions: [],
      guidance: "ok",
      findings: "none",
      model: "gpt",
      checkedAt: 1,
    },
    staticScan: {
      status: "suspicious",
      reasonCodes: ["scanner.example"],
      findings: [
        {
          code: "scanner.example",
          severity: "warn",
          file: "SKILL.md",
          line: 1,
          message: "Example finding",
          evidence: "SECRET_SNIPPET",
        },
      ],
      summary: "Something matched",
      engineVersion: "1",
      checkedAt: 1,
    },
  };
}

describe("public skill version queries", () => {
  beforeEach(() => {
    vi.mocked(getAuthUserId).mockReset();
    vi.mocked(getSkillBadgeMap).mockReset();
    vi.mocked(getSkillBadgeMaps).mockReset();
    vi.mocked(getAuthUserId).mockResolvedValue(null as never);
    vi.mocked(getSkillBadgeMap).mockResolvedValue({} as never);
    vi.mocked(getSkillBadgeMaps).mockResolvedValue(new Map() as never);
  });

  it("sanitizes latestVersion returned by getBySlug", async () => {
    const version = makeVersion();
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table !== "skills") throw new Error(`Unexpected table ${table}`);
          return {
            withIndex: vi.fn(() => ({
              unique: vi.fn().mockResolvedValue({
                _id: "skills:1",
                _creationTime: 1,
                slug: "demo",
                displayName: "Demo",
                summary: "Summary",
                ownerUserId: "users:1",
                canonicalSkillId: undefined,
                forkOf: undefined,
                latestVersionId: version._id,
                tags: {},
                stats: {
                  downloads: 1,
                  installsCurrent: 1,
                  installsAllTime: 1,
                  stars: 1,
                  versions: 1,
                  comments: 0,
                },
                createdAt: 1,
                updatedAt: 2,
                moderationStatus: "active",
                moderationFlags: undefined,
                moderationReason: undefined,
                softDeletedAt: undefined,
              }),
            })),
          };
        }),
        get: vi.fn(async (id: string) => {
          if (id === version._id) return version;
          if (id === "users:1") {
            return {
              _id: "users:1",
              _creationTime: 1,
              handle: "demo",
              name: "demo",
              displayName: "Demo",
              image: null,
              bio: null,
            };
          }
          return null;
        }),
      },
    } as never;

    const result = (await getBySlugHandler(ctx, { slug: "demo" } as never)) as {
      latestVersion?: {
        files: Array<Record<string, unknown>>;
        parsed?: Record<string, unknown>;
        staticScan?: { findings?: Array<{ evidence?: string }> };
      } | null;
    } | null;

    expect(result?.latestVersion?.files[0]).not.toHaveProperty("storageId");
    expect(result?.latestVersion?.parsed).toEqual({
      clawdis: { os: ["macos"] },
      license: "MIT-0",
    });
    expect(result?.latestVersion?.staticScan?.findings?.[0]?.evidence).toBe("");
  });

  it("sanitizes direct public version queries", async () => {
    const version = makeVersion();
    const unique = vi.fn().mockResolvedValue(version);
    const take = vi.fn().mockResolvedValue([version]);
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue(version),
        query: vi.fn((table: string) => {
          if (table !== "skillVersions") throw new Error(`Unexpected table ${table}`);
          return {
            withIndex: vi.fn(() => ({
              unique,
              order: vi.fn(() => ({ take })),
            })),
          };
        }),
      },
    } as never;

    const byId = (await getVersionByIdHandler(ctx, {
      versionId: version._id,
    } as never)) as {
      files: Array<Record<string, unknown>>;
      parsed?: Record<string, unknown>;
      staticScan?: { findings?: Array<{ evidence?: string }> };
    } | null;
    const byVersion = (await getVersionBySkillAndVersionHandler(ctx, {
      skillId: "skills:1",
      version: "1.0.0",
    } as never)) as {
      files: Array<Record<string, unknown>>;
      parsed?: Record<string, unknown>;
      staticScan?: { findings?: Array<{ evidence?: string }> };
    } | null;
    const list = (await listVersionsHandler(ctx, {
      skillId: "skills:1",
      limit: 5,
    } as never)) as Array<{
      files: Array<Record<string, unknown>>;
      parsed?: Record<string, unknown>;
      staticScan?: { findings?: Array<{ evidence?: string }> };
    }>;

    for (const result of [byId, byVersion, list[0]]) {
      expect(result?.files[0]).not.toHaveProperty("storageId");
      expect(result?.parsed).not.toHaveProperty("frontmatter");
      expect(result?.parsed).not.toHaveProperty("metadata");
      expect(result?.parsed).not.toHaveProperty("moltbot");
      expect(result?.staticScan?.findings?.[0]?.evidence).toBe("");
    }
  });

  it("sanitizes latestVersion in listWithLatest", async () => {
    const version = makeVersion();
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table !== "skills") throw new Error(`Unexpected table ${table}`);
          return {
            order: vi.fn(() => ({
              take: vi.fn().mockResolvedValue([
                {
                  _id: "skills:1",
                  _creationTime: 1,
                  slug: "demo",
                  displayName: "Demo",
                  summary: "Summary",
                  ownerUserId: "users:1",
                  canonicalSkillId: undefined,
                  forkOf: undefined,
                  latestVersionId: version._id,
                  tags: {},
                  badges: undefined,
                  stats: {
                    downloads: 1,
                    installsCurrent: 1,
                    installsAllTime: 1,
                    stars: 1,
                    versions: 1,
                    comments: 0,
                  },
                  createdAt: 1,
                  updatedAt: 2,
                  softDeletedAt: undefined,
                  moderationStatus: "active",
                  moderationFlags: undefined,
                  moderationReason: undefined,
                },
              ]),
            })),
          };
        }),
        get: vi.fn().mockResolvedValue(version),
      },
    } as never;

    const result = (await listWithLatestHandler(ctx, { limit: 1 } as never)) as Array<{
      latestVersion?: {
        files: Array<Record<string, unknown>>;
        parsed?: Record<string, unknown>;
      } | null;
    }>;
    expect(result[0]?.latestVersion?.files[0]).not.toHaveProperty("storageId");
    expect(result[0]?.latestVersion?.parsed).not.toHaveProperty("frontmatter");
  });
});
