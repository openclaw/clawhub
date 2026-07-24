import { CATALOG_FEED_ID, CATALOG_SKILLS_FEED_ID, EXPERIMENTAL_CLAW_FEED_ID } from "clawhub-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listOfficialClawEntries,
  listOfficialEntries,
  listOfficialSkillEntries,
  publish,
} from "./catalogFeed";

vi.mock("./lib/publishers", () => ({
  getOwnerPublisher: vi.fn().mockResolvedValue({ handle: "openclaw" }),
}));
vi.mock("./lib/officialPublishers", () => ({
  isOfficialPublisher: vi.fn().mockResolvedValue(true),
}));

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const listOfficialEntriesHandler = (
  listOfficialEntries as unknown as WrappedHandler<
    { family: "code-plugin" | "bundle-plugin" },
    unknown[]
  >
)._handler;
const listOfficialClawEntriesHandler = (
  listOfficialClawEntries as unknown as WrappedHandler<Record<string, never>, unknown[]>
)._handler;
const listOfficialSkillEntriesHandler = (
  listOfficialSkillEntries as unknown as WrappedHandler<
    { publisherId: string; cursor: string | null },
    unknown
  >
)._handler;
const publishHandler = (
  publish as unknown as WrappedHandler<{ expiresAt: string }, Array<{ feedId: string }>>
)._handler;

function makePackage(overrides: Record<string, unknown> = {}) {
  return {
    _id: "packages:1",
    name: "@openclaw/demo",
    normalizedName: "@openclaw/demo",
    displayName: "Demo",
    ownerUserId: "users:1",
    family: "code-plugin",
    channel: "official",
    isOfficial: true,
    latestReleaseId: "packageReleases:1",
    softDeletedAt: undefined,
    ...overrides,
  };
}

function makeRelease(overrides: Record<string, unknown> = {}) {
  return {
    packageId: "packages:1",
    version: "1.2.3",
    integritySha256: "ignored",
    artifactKind: "legacy-zip",
    sha256hash: "artifact-hash",
    verification: { scanStatus: "clean" },
    manualModeration: undefined,
    softDeletedAt: undefined,
    ...overrides,
  };
}

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    _id: "skills:1",
    slug: "demo",
    displayName: "Demo skill",
    ownerUserId: "users:1",
    ownerPublisherId: "publishers:1",
    latestVersionId: "skillVersions:1",
    softDeletedAt: undefined,
    moderationStatus: "active",
    ...overrides,
  };
}

function makeGitHubSkill(overrides: Record<string, unknown> = {}) {
  return makeSkill({
    installKind: "github",
    githubSourceId: "githubSkillSources:1",
    githubPath: "skills/aiq-deploy",
    githubCurrentCommit: "1".repeat(40),
    githubCurrentContentHash: "hash-aiq-deploy",
    githubCurrentStatus: "present",
    githubScanStatus: "clean",
    latestVersionId: undefined,
    latestVersionSummary: undefined,
    ...overrides,
  });
}

function makeSkillVersion(overrides: Record<string, unknown> = {}) {
  return {
    _id: "skillVersions:1",
    skillId: "skills:1",
    version: "1.2.3",
    softDeletedAt: undefined,
    files: [{ path: "SKILL.md", size: 1, storageId: "storage:1", sha256: "file-hash" }],
    sha256hash: "skill-hash",
    ...overrides,
  };
}

function makeGitHubSource(overrides: Record<string, unknown> = {}) {
  return {
    _id: "githubSkillSources:1",
    repo: "NVIDIA/skills",
    ownerPublisherId: "publishers:1",
    defaultBranch: "main",
    ...overrides,
  };
}

function makeFeedSkillEntry(index: number) {
  const id = `@openclaw/demo-${index.toString().padStart(3, "0")}`;
  return {
    type: "skill",
    id,
    title: `Demo ${index}`,
    version: "1.0.0",
    state: "available",
    publisher: { id: "openclaw", trust: "official" },
    install: {
      candidates: [
        {
          sourceRef: "public-clawhub",
          package: id,
          version: "1.0.0",
          integrity: `sha256:skill-${index}`,
        },
      ],
    },
  };
}

function makeCtx(
  packages: unknown[],
  records: Record<string, unknown>,
  options: { packageHighlightedAt?: number } = {},
) {
  return {
    db: {
      query: vi.fn((table: string) => {
        const query = {
          eq: vi.fn(() => query),
        };
        if (table === "packageBadges") {
          return {
            withIndex: vi.fn((_index: string, apply: (value: typeof query) => unknown) => {
              apply(query);
              return {
                unique: vi.fn(async () =>
                  options.packageHighlightedAt !== undefined
                    ? {
                        packageId: "packages:1",
                        kind: "highlighted",
                        byUserId: "users:moderator",
                        at: options.packageHighlightedAt,
                      }
                    : null,
                ),
              };
            }),
          };
        }
        return {
          withIndex: vi.fn((_index: string, apply: (value: typeof query) => unknown) => {
            apply(query);
            return {
              order: vi.fn(() => ({
                paginate: vi.fn(async () => ({
                  page: packages,
                  isDone: true,
                  continueCursor: "",
                })),
                take: vi.fn(async () => packages),
              })),
            };
          }),
          take: vi.fn(async () => [{ publisherId: "publishers:1" }]),
        };
      }),
      get: vi.fn(async (id: string) => records[id] ?? null),
    },
  };
}

describe("catalog feed projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("projects official releases into ClawHub install candidates", async () => {
    const result = await listOfficialEntriesHandler(
      makeCtx(
        [
          makePackage({
            summary: "Search flights, stays, and travel options.",
            icon: "https://cdn.example.test/expedia.png",
          }),
        ],
        {
          "packageReleases:1": makeRelease(),
        },
      ),
      { family: "code-plugin" },
    );

    expect(result).toEqual([
      {
        type: "plugin",
        id: "@openclaw/demo",
        title: "Demo",
        description: "Search flights, stays, and travel options.",
        icon: "https://cdn.example.test/expedia.png",
        version: "1.2.3",
        state: "available",
        featured: false,
        publisher: { id: "openclaw", trust: "official" },
        install: {
          candidates: [
            {
              sourceRef: "public-clawhub",
              package: "@openclaw/demo",
              version: "1.2.3",
              integrity: "sha256:artifact-hash",
            },
          ],
        },
      },
    ]);
  });

  it("projects highlighted official packages as featured install candidates", async () => {
    const result = await listOfficialEntriesHandler(
      makeCtx(
        [makePackage()],
        {
          "packageReleases:1": makeRelease(),
        },
        { packageHighlightedAt: 1_784_280_000_000 },
      ),
      { family: "code-plugin" },
    );

    expect(result).toEqual([
      expect.objectContaining({
        id: "@openclaw/demo",
        state: "available",
        featured: true,
        featuredAt: 1_784_280_000_000,
        install: {
          candidates: [
            expect.objectContaining({
              package: "@openclaw/demo",
            }),
          ],
        },
      }),
    ]);
  });

  it("projects validated Claw releases with only their safe summary", async () => {
    vi.stubEnv("CLAWHUB_EXPERIMENTAL_CLAWS", "1");
    const clawManifestSummary = {
      schemaVersion: 1,
      agent: { id: "triage", name: "Triage" },
      workspace: { bootstrapFiles: ["SOUL.md"], fileCount: 1 },
      packages: { skillCount: 1, pluginCount: 0 },
      mcpServerCount: 0,
      cronJobCount: 1,
    };
    const result = await listOfficialClawEntriesHandler(
      makeCtx([makePackage({ family: "claw" })], {
        "packageReleases:1": makeRelease({
          clawManifestSummary,
        }),
      }),
      {},
    );

    expect(result).toEqual([
      expect.objectContaining({
        type: "claw",
        id: "@openclaw/demo",
        clawManifestSummary,
        install: {
          candidates: [
            expect.objectContaining({
              package: "@openclaw/demo",
              version: "1.2.3",
              integrity: "sha256:artifact-hash",
            }),
          ],
        },
      }),
    ]);
  });

  it("excludes Claw releases without a validated manifest summary", async () => {
    vi.stubEnv("CLAWHUB_EXPERIMENTAL_CLAWS", "1");
    const result = await listOfficialClawEntriesHandler(
      makeCtx([makePackage({ family: "claw" })], {
        "packageReleases:1": makeRelease(),
      }),
      {},
    );

    expect(result).toEqual([]);
  });

  it("excludes non-official, blocked, deleted, and undigested releases", async () => {
    const result = await listOfficialEntriesHandler(
      makeCtx(
        [
          makePackage({ name: "@openclaw/community", channel: "community" }),
          makePackage({ name: "@openclaw/deleted", softDeletedAt: 1 }),
          makePackage({ name: "@openclaw/malicious", latestReleaseId: "packageReleases:2" }),
          makePackage({ name: "@openclaw/no-hash", latestReleaseId: "packageReleases:3" }),
        ],
        {
          "packageReleases:1": makeRelease(),
          "packageReleases:2": makeRelease({ manualModeration: { state: "quarantined" } }),
          "packageReleases:3": makeRelease({ sha256hash: undefined }),
        },
      ),
      { family: "code-plugin" },
    );

    expect(result).toEqual([]);
  });

  it("re-checks the live official publisher record", async () => {
    const { isOfficialPublisher } = await import("./lib/officialPublishers");
    vi.mocked(isOfficialPublisher).mockResolvedValueOnce(false);

    const result = await listOfficialEntriesHandler(
      makeCtx([makePackage()], {
        "packageReleases:1": makeRelease(),
      }),
      { family: "code-plugin" },
    );

    expect(result).toEqual([]);
  });

  it("rejects a latest-release pointer for another package", async () => {
    const result = await listOfficialEntriesHandler(
      makeCtx([makePackage({ _id: "packages:2" })], {
        "packageReleases:1": makeRelease(),
      }),
      { family: "code-plugin" },
    );

    expect(result).toEqual([]);
  });

  it("projects only published skills from verified organization publishers", async () => {
    const result = (await listOfficialSkillEntriesHandler(
      makeCtx([makeSkill({ summary: "Deploy AIQ services.", icon: "lucide:rocket" })], {
        "publishers:1": { _id: "publishers:1", kind: "org", handle: "openclaw" },
        "skillVersions:1": makeSkillVersion(),
      }),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[]; isDone: boolean };

    expect(result).toMatchObject({
      entries: [
        {
          type: "skill",
          id: "@openclaw/demo",
          title: "Demo skill",
          description: "Deploy AIQ services.",
          icon: "lucide:rocket",
          version: "1.2.3",
          state: "available",
          featured: false,
          publisher: { id: "openclaw", trust: "official" },
          install: {
            candidates: [
              {
                sourceRef: "public-clawhub",
                package: "@openclaw/demo",
                version: "1.2.3",
                integrity: "sha256:skill-hash",
              },
            ],
          },
        },
      ],
      isDone: true,
    });
  });

  it("projects highlighted official skills as featured install candidates", async () => {
    const result = (await listOfficialSkillEntriesHandler(
      makeCtx(
        [
          makeSkill({
            badges: {
              highlighted: { byUserId: "users:moderator", at: 1_784_280_000_000 },
            },
          }),
        ],
        {
          "publishers:1": { _id: "publishers:1", kind: "org", handle: "openclaw" },
          "skillVersions:1": makeSkillVersion(),
        },
      ),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[]; isDone: boolean };

    expect(result.entries).toEqual([
      expect.objectContaining({
        id: "@openclaw/demo",
        state: "available",
        featured: true,
        featuredAt: 1_784_280_000_000,
      }),
    ]);
  });

  it("keeps suspicious hosted skills in hosted ClawHub install candidates", async () => {
    const result = (await listOfficialSkillEntriesHandler(
      makeCtx([makeSkill()], {
        "publishers:1": { _id: "publishers:1", kind: "org", handle: "openclaw" },
        "skillVersions:1": makeSkillVersion({
          llmAnalysis: { status: "complete", verdict: "suspicious" },
        }),
      }),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[]; isDone: boolean };

    expect(result.entries).toMatchObject([
      {
        id: "@openclaw/demo",
        state: "available",
        install: {
          candidates: [
            {
              sourceRef: "public-clawhub",
              package: "@openclaw/demo",
            },
          ],
        },
      },
    ]);
  });

  it("projects current GitHub-backed skills into public GitHub install candidates", async () => {
    const result = (await listOfficialSkillEntriesHandler(
      makeCtx([makeGitHubSkill({ slug: "aiq-deploy", displayName: "AIQ Deploy" })], {
        "publishers:1": { _id: "publishers:1", kind: "org", handle: "nvidia" },
        "githubSkillSources:1": makeGitHubSource(),
      }),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[]; isDone: boolean };

    expect(result).toMatchObject({
      entries: [
        {
          type: "skill",
          id: "@nvidia/aiq-deploy",
          title: "AIQ Deploy",
          version: "1111111111111111111111111111111111111111",
          state: "available",
          featured: false,
          publisher: { id: "nvidia", trust: "official" },
          install: {
            candidates: [
              {
                sourceRef: "public-github",
                package: "@nvidia/aiq-deploy",
                version: "1111111111111111111111111111111111111111",
                integrity: "sha256:hash-aiq-deploy",
                github: {
                  repo: "NVIDIA/skills",
                  path: "skills/aiq-deploy",
                  commit: "1111111111111111111111111111111111111111",
                  contentHash: "hash-aiq-deploy",
                },
              },
            ],
          },
        },
      ],
      isDone: true,
    });
  });

  it("caps oversized skills feeds instead of blocking plugin publication", async () => {
    const skillEntries = Array.from({ length: 1001 }, (_, index) => makeFeedSkillEntry(index));
    const runMutation = vi.fn(
      async (_ref: unknown, args: { feedId: string; entries: unknown[] }) => ({
        feedId: args.feedId,
        entryCount: args.entries.length,
      }),
    );
    const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("family" in args) return [];
      if ("publisherId" in args) {
        return { entries: skillEntries, isDone: true, continueCursor: "" };
      }
      return {
        publishers: [{ _id: "publishers:1" }],
        isDone: true,
        continueCursor: "",
      };
    });

    const result = await publishHandler(
      { runQuery, runMutation },
      { expiresAt: "2026-06-30T00:00:00.000Z" },
    );

    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ feedId: CATALOG_FEED_ID, entries: [] }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        feedId: CATALOG_SKILLS_FEED_ID,
        entries: expect.arrayContaining([expect.objectContaining({ id: "@openclaw/demo-999" })]),
      }),
    );
    expect(
      vi
        .mocked(runMutation)
        .mock.calls.find(([, args]) => args.feedId === CATALOG_SKILLS_FEED_ID)?.[1].entries,
    ).toHaveLength(1000);
    expect(result).toEqual([
      { feedId: CATALOG_FEED_ID, entryCount: 0 },
      { feedId: CATALOG_SKILLS_FEED_ID, entryCount: 1000 },
    ]);
  });

  it("publishes Claws through the separate experimental mutation", async () => {
    vi.stubEnv("CLAWHUB_EXPERIMENTAL_CLAWS", "1");
    const clawEntry = {
      type: "claw",
      id: "@openclaw/triage",
      title: "Triage",
      version: "1.0.0",
      state: "available",
      publisher: { id: "openclaw", trust: "official" },
      clawManifestSummary: {
        schemaVersion: 1,
        agent: { id: "triage" },
        workspace: { bootstrapFiles: [], fileCount: 0 },
        packages: { skillCount: 0, pluginCount: 0 },
        mcpServerCount: 0,
        cronJobCount: 0,
      },
      install: {
        candidates: [
          {
            sourceRef: "public-clawhub",
            package: "@openclaw/triage",
            version: "1.0.0",
            integrity: "sha256:abc",
          },
        ],
      },
    };
    const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("family" in args) return [];
      if ("cursor" in args) return { publishers: [], isDone: true, continueCursor: "" };
      return [clawEntry];
    });
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => ({
      feedId: typeof args.feedId === "string" ? args.feedId : EXPERIMENTAL_CLAW_FEED_ID,
      entryCount: Array.isArray(args.entries) ? args.entries.length : 0,
    }));

    const result = await publishHandler(
      { runQuery, runMutation },
      { expiresAt: "2026-07-20T00:00:00.000Z" },
    );

    expect(runMutation).toHaveBeenCalledTimes(3);
    expect(runMutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ entries: [clawEntry] }),
    );
    expect(runMutation.mock.calls.at(-1)?.[1]).not.toHaveProperty("feedId");
    expect(result.at(-1)).toEqual({ feedId: EXPERIMENTAL_CLAW_FEED_ID, entryCount: 1 });
  });

  it("projects suspicious current GitHub-backed skills into public GitHub install candidates", async () => {
    const result = (await listOfficialSkillEntriesHandler(
      makeCtx(
        [
          makeGitHubSkill({
            slug: "aiq-suspicious",
            displayName: "AIQ Suspicious",
            githubScanStatus: "suspicious",
          }),
        ],
        {
          "publishers:1": { _id: "publishers:1", kind: "org", handle: "nvidia" },
          "githubSkillSources:1": makeGitHubSource(),
        },
      ),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[]; isDone: boolean };

    expect(result.entries).toMatchObject([
      {
        id: "@nvidia/aiq-suspicious",
        state: "available",
        install: {
          candidates: [
            {
              sourceRef: "public-github",
              github: {
                repo: "NVIDIA/skills",
                path: "skills/aiq-deploy",
                commit: "1111111111111111111111111111111111111111",
                contentHash: "hash-aiq-deploy",
              },
            },
          ],
        },
      },
    ]);
  });

  it("includes skills from verified personal publishers", async () => {
    const result = (await listOfficialSkillEntriesHandler(
      makeCtx([makeSkill({ ownerPublisherId: "publishers:steipete" })], {
        "publishers:steipete": { _id: "publishers:steipete", kind: "user", handle: "steipete" },
        "skillVersions:1": makeSkillVersion(),
      }),
      { publisherId: "publishers:steipete", cursor: null },
    )) as { entries: unknown[]; isDone: boolean };

    expect(result.entries).toMatchObject([
      {
        type: "skill",
        id: "@steipete/demo",
        publisher: { id: "steipete", trust: "official" },
      },
    ]);
  });

  it("excludes a latest version blocked by the download safety gate", async () => {
    const result = (await listOfficialSkillEntriesHandler(
      makeCtx([makeSkill()], {
        "publishers:1": { _id: "publishers:1", kind: "org", handle: "openclaw" },
        "skillVersions:1": makeSkillVersion({
          llmAnalysis: { status: "complete", verdict: "malicious" },
        }),
      }),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[]; isDone: boolean };

    expect(result.entries).toEqual([]);
  });

  it("excludes unavailable GitHub-backed skills from public GitHub candidates", async () => {
    const blockedStates = [
      makeGitHubSkill({ slug: "pending-scan", githubScanStatus: "pending" }),
      makeGitHubSkill({ slug: "failed-scan", githubScanStatus: "failed" }),
      makeGitHubSkill({ slug: "malicious-scan", githubScanStatus: "malicious" }),
      makeGitHubSkill({ slug: "missing-upstream", githubCurrentStatus: "missing" }),
      makeGitHubSkill({ slug: "removed-upstream", githubRemovedAt: 1 }),
      makeGitHubSkill({ slug: "hidden", moderationStatus: "hidden" }),
      makeGitHubSkill({ slug: "missing-source", githubSourceId: undefined }),
      makeGitHubSkill({ slug: "missing-path", githubPath: undefined }),
      makeGitHubSkill({ slug: "missing-commit", githubCurrentCommit: undefined }),
      makeGitHubSkill({ slug: "missing-hash", githubCurrentContentHash: undefined }),
    ];

    const result = (await listOfficialSkillEntriesHandler(
      makeCtx(blockedStates, {
        "publishers:1": { _id: "publishers:1", kind: "org", handle: "nvidia" },
        "githubSkillSources:1": makeGitHubSource(),
      }),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[] };

    expect(result.entries).toEqual([]);
  });

  it("excludes GitHub-backed skills from non-official publishers", async () => {
    vi.mocked((await import("./lib/officialPublishers")).isOfficialPublisher).mockResolvedValue(
      false,
    );

    const result = (await listOfficialSkillEntriesHandler(
      makeCtx([makeGitHubSkill({ slug: "community-source" })], {
        "publishers:community": {
          _id: "publishers:community",
          kind: "org",
          handle: "community",
        },
        "githubSkillSources:1": makeGitHubSource({ ownerPublisherId: "publishers:community" }),
      }),
      { publisherId: "publishers:community", cursor: null },
    )) as { entries: unknown[] };

    expect(result.entries).toEqual([]);
  });

  it("excludes unverified, unpublished, and un-hashed skills", async () => {
    vi.mocked((await import("./lib/officialPublishers")).isOfficialPublisher).mockImplementation(
      async (_ctx, publisher) => publisher?._id === "publishers:1",
    );

    const unverified = (await listOfficialSkillEntriesHandler(
      makeCtx([makeSkill({ ownerPublisherId: "publishers:unverified" })], {
        "publishers:unverified": { _id: "publishers:unverified", kind: "org", handle: "vendor" },
        "skillVersions:1": makeSkillVersion(),
      }),
      { publisherId: "publishers:unverified", cursor: null },
    )) as { entries: unknown[] };
    const unpublishedOrUnhashed = (await listOfficialSkillEntriesHandler(
      makeCtx(
        [
          makeSkill({ latestVersionId: undefined }),
          makeSkill({ _id: "skills:no-hash", latestVersionId: "skillVersions:no-hash" }),
        ],
        {
          "publishers:1": { _id: "publishers:1", kind: "org", handle: "openclaw" },
          "skillVersions:no-hash": makeSkillVersion({ sha256hash: undefined }),
        },
      ),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[] };

    expect(unverified.entries).toEqual([]);
    expect(unpublishedOrUnhashed.entries).toEqual([]);
  });
});
