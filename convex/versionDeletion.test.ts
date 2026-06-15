/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

const skillsModule = (await import("./skills")) as unknown as Record<string, unknown>;
const packagesModule = (await import("./packages")) as unknown as Record<string, unknown>;

type DeletionHelper<TArgs> = (ctx: unknown, actor: unknown, args: TArgs) => Promise<unknown>;

function getDeletionHelper<TArgs>(
  module: Record<string, unknown>,
  name: string,
): DeletionHelper<TArgs> {
  expect(module[name], `${name} export`).toBeTypeOf("function");
  return module[name] as DeletionHelper<TArgs>;
}

const skillStats = {
  downloads: 5,
  installsCurrent: 2,
  installsAllTime: 3,
  stars: 1,
  versions: 2,
  comments: 0,
};

function makeSkillVersion(id: string, version: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    skillId: "skills:demo",
    version,
    changelog: `${version} changes`,
    changelogSource: "user",
    parsed: {
      frontmatter: {
        name: `Demo ${version}`,
        description: `Description ${version}`,
      },
      clawdis: { version },
    },
    icon: `lucide:${version}`,
    capabilityTags: [`cap-${version}`],
    createdAt: version === "2.0.0" ? 20 : 10,
    createdBy: "users:owner",
    softDeletedAt: undefined,
    manualRevocation: { reason: "preserve-me" },
    ...overrides,
  };
}

function makeSkillDeletionCtx(options: {
  skill?: Record<string, unknown>;
  versions?: Array<Record<string, unknown>>;
  embeddings?: Array<Record<string, unknown>>;
  membership?: Record<string, unknown> | null;
}) {
  const versions = options.versions ?? [
    makeSkillVersion("skillVersions:v1", "1.0.0"),
    makeSkillVersion("skillVersions:v2", "2.0.0"),
  ];
  const skill =
    options.skill ??
    ({
      _id: "skills:demo",
      slug: "demo",
      displayName: "Demo 2.0.0",
      summary: "Description 2.0.0",
      icon: "lucide:2.0.0",
      ownerUserId: "users:owner",
      ownerPublisherId: undefined,
      latestVersionId: "skillVersions:v2",
      latestVersionSummary: {
        version: "2.0.0",
        createdAt: 20,
        changelog: "2.0.0 changes",
      },
      tags: {
        latest: "skillVersions:v2",
        stable: "skillVersions:v2",
        legacy: "skillVersions:v1",
      },
      capabilityTags: ["cap-2.0.0"],
      moderationStatus: "active",
      moderationReason: "scanner.aggregate.clean",
      moderationSourceVersionId: "skillVersions:v2",
      moderationVerdict: "clean",
      isSuspicious: false,
      stats: skillStats,
      softDeletedAt: undefined,
      updatedAt: 20,
    } as Record<string, unknown>);
  const embeddings = options.embeddings ?? [
    {
      _id: "skillEmbeddings:v1",
      versionId: "skillVersions:v1",
      isLatest: false,
      isApproved: false,
      visibility: "public",
    },
    {
      _id: "skillEmbeddings:v2",
      versionId: "skillVersions:v2",
      isLatest: true,
      isApproved: false,
      visibility: "public",
    },
  ];
  const actors: Record<string, Record<string, unknown>> = {
    "users:owner": { _id: "users:owner", role: "user" },
    "users:admin": { _id: "users:admin", role: "admin" },
    "users:moderator": { _id: "users:moderator", role: "moderator" },
    "users:org-admin": { _id: "users:org-admin", role: "user" },
  };
  const audits: Array<Record<string, unknown>> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: vi.fn(async (id: string) => {
        if (id === skill._id) return skill;
        if (id === "publishers:org") return { _id: id, kind: "org" };
        return (
          actors[id] ??
          versions.find((version) => version._id === id) ??
          embeddings.find((embedding) => embedding._id === id) ??
          null
        );
      }),
      query: vi.fn((table: string) => {
        if (table === "skillVersions") {
          return {
            withIndex: vi.fn(() => ({
              collect: vi.fn().mockResolvedValue(versions),
            })),
          };
        }
        if (table === "skillEmbeddings") {
          return {
            withIndex: vi.fn(() => ({
              collect: vi.fn().mockResolvedValue(embeddings),
            })),
          };
        }
        if (table === "publisherMembers") {
          return {
            withIndex: vi.fn(() => ({
              unique: vi.fn().mockResolvedValue(options.membership ?? null),
            })),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
        const row =
          (id === skill._id ? skill : null) ??
          versions.find((version) => version._id === id) ??
          embeddings.find((embedding) => embedding._id === id);
        if (row) Object.assign(row, patch);
      }),
      insert: vi.fn(async (table: string, row: Record<string, unknown>) => {
        if (table !== "auditLogs") throw new Error(`Unexpected insert table ${table}`);
        audits.push(row);
        return "auditLogs:1";
      }),
    },
  };
  return { actors, audits, ctx, embeddings, patches, skill, versions };
}

function makePackageRelease(id: string, version: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    packageId: "packages:demo",
    version,
    distTags: version === "2.0.0" ? ["latest"] : ["stable"],
    createdAt: version === "2.0.0" ? 20 : 10,
    createdBy: "users:owner",
    softDeletedAt: undefined,
    manualRevocation: { reason: "preserve-me" },
    ...overrides,
  };
}

function makePackageDeletionCtx(options: {
  pkg?: Record<string, unknown>;
  releases?: Array<Record<string, unknown>>;
  membership?: Record<string, unknown> | null;
}) {
  const releases = options.releases ?? [
    makePackageRelease("packageReleases:v1", "1.0.0"),
    makePackageRelease("packageReleases:v2", "2.0.0"),
  ];
  const pkg =
    options.pkg ??
    ({
      _id: "packages:demo",
      name: "demo-plugin",
      normalizedName: "demo-plugin",
      family: "code-plugin",
      ownerUserId: "users:owner",
      ownerPublisherId: undefined,
      softDeletedAt: undefined,
    } as Record<string, unknown>);
  const actors: Record<string, Record<string, unknown>> = {
    "users:owner": { _id: "users:owner", role: "user" },
    "users:admin": { _id: "users:admin", role: "admin" },
    "users:moderator": { _id: "users:moderator", role: "moderator" },
    "users:org-admin": { _id: "users:org-admin", role: "user" },
  };
  const audits: Array<Record<string, unknown>> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      get: vi.fn(async (id: string) => {
        if (id === "publishers:org") return { _id: id, kind: "org" };
        return actors[id] ?? null;
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
            withIndex: vi.fn((index: string) => ({
              unique: vi
                .fn()
                .mockResolvedValue(
                  index === "by_package_version"
                    ? releases.find((release) => release.version === "2.0.0")
                    : null,
                ),
              take: vi
                .fn()
                .mockResolvedValue(
                  releases.filter((release) => !release.softDeletedAt).slice(0, 2),
                ),
              collect: vi
                .fn()
                .mockResolvedValue(releases.filter((release) => !release.softDeletedAt)),
            })),
          };
        }
        if (table === "publisherMembers") {
          return {
            withIndex: vi.fn(() => ({
              unique: vi.fn().mockResolvedValue(options.membership ?? null),
            })),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
        const release = releases.find((candidate) => candidate._id === id);
        if (release) Object.assign(release, patch);
      }),
      insert: vi.fn(async (table: string, row: Record<string, unknown>) => {
        if (table !== "auditLogs") throw new Error(`Unexpected insert table ${table}`);
        audits.push(row);
        return "auditLogs:1";
      }),
    },
  };
  return { actors, audits, ctx, patches, pkg, releases };
}

describe("owner skill version deletion", () => {
  it("exports the public mutation contract", () => {
    expect(skillsModule.deleteOwnedVersion).toBeTypeOf("function");
  });

  it("deletes latest with provenance, audit, and fallback metadata without changing stats", async () => {
    const deleteOwned = getDeletionHelper<{ versionId: string }>(
      skillsModule,
      "deleteOwnedSkillVersionForActor",
    );
    const { actors, audits, ctx, embeddings, patches, skill, versions } = makeSkillDeletionCtx({});

    await deleteOwned(ctx, actors["users:owner"], { versionId: "skillVersions:v2" });

    const ownerDeletedPatch = patches.find(({ id }) => id === "skillVersions:v2")?.patch;
    expect(ownerDeletedPatch).toEqual({
      softDeletedAt: expect.any(Number),
      ownerDeletedAt: expect.any(Number),
      ownerDeletedBy: "users:owner",
    });
    expect(ownerDeletedPatch?.softDeletedAt).toBe(ownerDeletedPatch?.ownerDeletedAt);
    expect(versions[1]?.manualRevocation).toEqual({ reason: "preserve-me" });
    expect(skill).toMatchObject({
      latestVersionId: "skillVersions:v1",
      latestVersionSummary: expect.objectContaining({ version: "1.0.0" }),
      displayName: "Demo 1.0.0",
      summary: "Description 1.0.0",
      icon: "lucide:1.0.0",
      capabilityTags: ["cap-1.0.0"],
      moderationSourceVersionId: "skillVersions:v1",
      tags: {
        latest: "skillVersions:v1",
        legacy: "skillVersions:v1",
      },
      stats: skillStats,
    });
    expect(embeddings).toEqual([
      expect.objectContaining({ versionId: "skillVersions:v1", isLatest: true }),
      expect.objectContaining({ versionId: "skillVersions:v2", isLatest: false }),
    ]);
    expect(audits).toContainEqual(
      expect.objectContaining({
        actorUserId: "users:owner",
        action: "skill.version.delete",
        targetType: "skillVersion",
        targetId: "skillVersions:v2",
        metadata: expect.objectContaining({
          skillId: "skills:demo",
          slug: "demo",
          version: "2.0.0",
        }),
      }),
    );
  });

  it("deletes a non-latest version without changing latest metadata", async () => {
    const deleteOwned = getDeletionHelper<{ versionId: string }>(
      skillsModule,
      "deleteOwnedSkillVersionForActor",
    );
    const { actors, ctx, skill } = makeSkillDeletionCtx({
      skill: {
        ...makeSkillDeletionCtx({}).skill,
        tags: {
          latest: "skillVersions:v2",
          stable: "skillVersions:v2",
          legacy: "skillVersions:v1",
        },
      },
    });
    const before = {
      latestVersionId: skill.latestVersionId,
      latestVersionSummary: skill.latestVersionSummary,
      displayName: skill.displayName,
      stats: skill.stats,
    };

    await deleteOwned(ctx, actors["users:owner"], { versionId: "skillVersions:v1" });

    expect(skill).toMatchObject({
      ...before,
      tags: {
        latest: "skillVersions:v2",
        stable: "skillVersions:v2",
      },
    });
  });

  it("rejects the only active skill version with whole-skill guidance", async () => {
    const deleteOwned = getDeletionHelper<{ versionId: string }>(
      skillsModule,
      "deleteOwnedSkillVersionForActor",
    );
    const onlyVersion = makeSkillVersion("skillVersions:v2", "2.0.0");
    const { actors, ctx, patches } = makeSkillDeletionCtx({ versions: [onlyVersion] });

    await expect(
      deleteOwned(ctx, actors["users:owner"], { versionId: "skillVersions:v2" }),
    ).rejects.toThrow(/only active version.*remove the whole skill/i);
    expect(patches).toEqual([]);
  });

  it("rejects deletion when the parent skill is not active", async () => {
    const deleteOwned = getDeletionHelper<{ versionId: string }>(
      skillsModule,
      "deleteOwnedSkillVersionForActor",
    );
    const { actors, ctx, patches } = makeSkillDeletionCtx({
      skill: {
        ...makeSkillDeletionCtx({}).skill,
        moderationStatus: "hidden",
      },
    });

    await expect(
      deleteOwned(ctx, actors["users:owner"], { versionId: "skillVersions:v2" }),
    ).rejects.toThrow(/skill is unavailable/i);
    expect(patches).toEqual([]);
  });

  it("allows an org admin to delete an owned skill version", async () => {
    const deleteOwned = getDeletionHelper<{ versionId: string }>(
      skillsModule,
      "deleteOwnedSkillVersionForActor",
    );
    const { actors, ctx, patches } = makeSkillDeletionCtx({
      skill: {
        ...makeSkillDeletionCtx({}).skill,
        ownerPublisherId: "publishers:org",
      },
      membership: {
        publisherId: "publishers:org",
        userId: "users:org-admin",
        role: "admin",
      },
    });

    await expect(
      deleteOwned(ctx, actors["users:org-admin"], { versionId: "skillVersions:v2" }),
    ).resolves.toMatchObject({ ok: true });
    expect(patches).toContainEqual(
      expect.objectContaining({
        id: "skillVersions:v2",
        patch: expect.objectContaining({ ownerDeletedBy: "users:org-admin" }),
      }),
    );
  });

  it("does not let platform staff bypass skill ownership", async () => {
    const deleteOwned = getDeletionHelper<{ versionId: string }>(
      skillsModule,
      "deleteOwnedSkillVersionForActor",
    );

    for (const actorId of ["users:admin", "users:moderator"]) {
      const { actors, ctx, patches } = makeSkillDeletionCtx({});
      await expect(
        deleteOwned(ctx, actors[actorId], { versionId: "skillVersions:v2" }),
      ).rejects.toThrow("Forbidden");
      expect(patches).toEqual([]);
    }
  });
});

describe("owner package release deletion", () => {
  it("exports the public mutation contract", () => {
    expect(packagesModule.deleteOwnedRelease).toBeTypeOf("function");
  });

  it("deletes a release with provenance and audit while preserving unrelated metadata", async () => {
    const deleteOwned = getDeletionHelper<{ name: string; version: string }>(
      packagesModule,
      "deleteOwnedPackageReleaseForActor",
    );
    const { actors, audits, ctx, patches, releases } = makePackageDeletionCtx({});

    await deleteOwned(ctx, actors["users:owner"], { name: "demo-plugin", version: "2.0.0" });

    const ownerDeletedPatch = patches.find(({ id }) => id === "packageReleases:v2")?.patch;
    expect(ownerDeletedPatch).toEqual({
      softDeletedAt: expect.any(Number),
      ownerDeletedAt: expect.any(Number),
      ownerDeletedBy: "users:owner",
    });
    expect(ownerDeletedPatch?.softDeletedAt).toBe(ownerDeletedPatch?.ownerDeletedAt);
    expect(releases[1]?.manualRevocation).toEqual({ reason: "preserve-me" });
    expect(audits).toContainEqual(
      expect.objectContaining({
        actorUserId: "users:owner",
        action: "package.release.delete",
        targetType: "packageRelease",
        targetId: "packageReleases:v2",
        metadata: expect.objectContaining({
          packageId: "packages:demo",
          name: "demo-plugin",
          version: "2.0.0",
        }),
      }),
    );
  });

  it("allows an org admin to delete an owned package release", async () => {
    const deleteOwned = getDeletionHelper<{ name: string; version: string }>(
      packagesModule,
      "deleteOwnedPackageReleaseForActor",
    );
    const { actors, ctx, patches } = makePackageDeletionCtx({
      pkg: {
        ...makePackageDeletionCtx({}).pkg,
        ownerPublisherId: "publishers:org",
      },
      membership: {
        publisherId: "publishers:org",
        userId: "users:org-admin",
        role: "admin",
      },
    });

    await expect(
      deleteOwned(ctx, actors["users:org-admin"], { name: "demo-plugin", version: "2.0.0" }),
    ).resolves.toMatchObject({ ok: true });
    expect(patches).toContainEqual(
      expect.objectContaining({
        id: "packageReleases:v2",
        patch: expect.objectContaining({ ownerDeletedBy: "users:org-admin" }),
      }),
    );
  });

  it("does not let platform staff bypass package ownership", async () => {
    const deleteOwned = getDeletionHelper<{ name: string; version: string }>(
      packagesModule,
      "deleteOwnedPackageReleaseForActor",
    );

    for (const actorId of ["users:admin", "users:moderator"]) {
      const { actors, ctx, patches } = makePackageDeletionCtx({});
      await expect(
        deleteOwned(ctx, actors[actorId], { name: "demo-plugin", version: "2.0.0" }),
      ).rejects.toThrow("Forbidden");
      expect(patches).toEqual([]);
    }
  });

  it("rejects the only active package release with whole-package guidance", async () => {
    const deleteOwned = getDeletionHelper<{ name: string; version: string }>(
      packagesModule,
      "deleteOwnedPackageReleaseForActor",
    );
    const onlyRelease = makePackageRelease("packageReleases:v2", "2.0.0");
    const { actors, ctx, patches } = makePackageDeletionCtx({ releases: [onlyRelease] });

    await expect(
      deleteOwned(ctx, actors["users:owner"], { name: "demo-plugin", version: "2.0.0" }),
    ).rejects.toThrow(/only active release.*remove the whole package/i);
    expect(patches).toEqual([]);
  });

  it("does not count owner-deleted provenance as another active package release", async () => {
    const deleteOwned = getDeletionHelper<{ name: string; version: string }>(
      packagesModule,
      "deleteOwnedPackageReleaseForActor",
    );
    const target = makePackageRelease("packageReleases:v2", "2.0.0");
    const ownerDeleted = makePackageRelease("packageReleases:v1", "1.0.0", {
      ownerDeletedAt: 10,
      ownerDeletedBy: "users:owner",
    });
    const { actors, ctx, patches } = makePackageDeletionCtx({
      releases: [ownerDeleted, target],
    });

    await expect(
      deleteOwned(ctx, actors["users:owner"], { name: "demo-plugin", version: "2.0.0" }),
    ).rejects.toThrow(/only active release.*remove the whole package/i);
    expect(patches).toEqual([]);
  });

  it("rejects skill-family packages to preserve the single skill deletion path", async () => {
    const deleteOwned = getDeletionHelper<{ name: string; version: string }>(
      packagesModule,
      "deleteOwnedPackageReleaseForActor",
    );
    const { actors, ctx, patches } = makePackageDeletionCtx({
      pkg: {
        ...makePackageDeletionCtx({}).pkg,
        family: "skill",
      },
    });

    await expect(
      deleteOwned(ctx, actors["users:owner"], { name: "demo-plugin", version: "2.0.0" }),
    ).rejects.toThrow(/skills deletion flow/i);
    expect(patches).toEqual([]);
  });
});
