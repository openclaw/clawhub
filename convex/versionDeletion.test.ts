/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

const skillsModule = (await import("./skills")) as unknown as Record<string, unknown>;
const packagesModule = (await import("./packages")) as unknown as Record<string, unknown>;
const { getAuthUserId } = await import("@convex-dev/auth/server");

type DeletionHelper<TArgs> = (ctx: unknown, actor: unknown, args: TArgs) => Promise<unknown>;
type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const deleteOwnedReleaseHandler = (
  packagesModule.deleteOwnedRelease as WrappedHandler<{ name: string; version: string }>
)._handler;

afterEach(() => {
  vi.mocked(getAuthUserId).mockReset();
});

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
    ...overrides,
  };
}

function makeSkillDeletionCtx(options: {
  skill?: Record<string, unknown>;
  versions?: Array<Record<string, unknown>>;
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
  const actors: Record<string, Record<string, unknown>> = {
    "users:owner": { _id: "users:owner", role: "user" },
    "users:admin": { _id: "users:admin", role: "admin" },
    "users:moderator": { _id: "users:moderator", role: "moderator" },
    "users:org-admin": { _id: "users:org-admin", role: "user" },
  };
  const audits: Array<Record<string, unknown>> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const skillVersionTakeLimits: number[] = [];
  const ctx = {
    db: {
      get: vi.fn(async (id: string) => {
        if (id === skill._id) return skill;
        if (id === "publishers:org") return { _id: id, kind: "org" };
        return actors[id] ?? versions.find((version) => version._id === id) ?? null;
      }),
      query: vi.fn((table: string) => {
        if (table === "skillVersions") {
          return {
            withIndex: vi.fn((index: string) => ({
              take: vi.fn(async (limit: number) => {
                if (index !== "by_skill_active_created") {
                  throw new Error(`Unexpected skillVersions index ${index}`);
                }
                skillVersionTakeLimits.push(limit);
                return versions.filter((version) => !version.softDeletedAt).slice(0, limit);
              }),
              collect: vi.fn(() => {
                throw new Error("skill deletion must not scan version history");
              }),
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
          (id === skill._id ? skill : null) ?? versions.find((version) => version._id === id);
        if (row) Object.assign(row, patch);
      }),
      insert: vi.fn(async (table: string, row: Record<string, unknown>) => {
        if (table !== "auditLogs") throw new Error(`Unexpected insert table ${table}`);
        audits.push(row);
        return "auditLogs:1";
      }),
    },
  };
  return { actors, audits, ctx, patches, skill, skillVersionTakeLimits, versions };
}

function makePackageRelease(id: string, version: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    _creationTime: version === "2.0.0" ? 20 : 10,
    packageId: "packages:demo",
    version,
    changelog: `${version} changes`,
    summary: `${version} summary`,
    distTags: version === "2.0.0" ? ["latest"] : ["stable"],
    files: [],
    integritySha256: `${version}-integrity`,
    artifactKind: "npm-pack",
    clawpackSha256: `${version}-sha256`,
    clawpackSize: version === "2.0.0" ? 200 : 100,
    clawpackFormat: "tgz",
    compatibility: { openclaw: `^${version}` },
    capabilities: {
      capabilityTags: [`cap-${version}`],
      executesCode: version === "2.0.0",
      runtimeId: `runtime.${version}`,
    },
    runtimeId: `runtime.${version}`,
    sourceRepo: `openclaw/demo-${version}`,
    verification: { tier: version === "2.0.0" ? "community" : "verified" },
    staticScan: {
      status: "clean",
      reasonCodes: [],
      findings: [],
      summary: "clean",
      engineVersion: "test",
      checkedAt: version === "2.0.0" ? 20 : 10,
    },
    createdAt: version === "2.0.0" ? 20 : 10,
    createdBy: "users:owner",
    softDeletedAt: undefined,
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
      tags: {
        latest: "packageReleases:v2",
        stable: "packageReleases:v2",
        legacy: "packageReleases:v1",
      },
      latestReleaseId: "packageReleases:v2",
      latestVersionSummary: { version: "2.0.0" },
      softDeletedAt: undefined,
    } as Record<string, unknown>);
  const actors: Record<string, Record<string, unknown>> = {
    "users:owner": { _id: "users:owner", role: "user" },
    "users:admin": { _id: "users:admin", role: "admin" },
    "users:moderator": { _id: "users:moderator", role: "moderator" },
    "users:org-admin": { _id: "users:org-admin", role: "user" },
  };
  const audits: Array<Record<string, unknown>> = [];
  const packageReleaseTakeLimits: number[] = [];
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
            withIndex: vi.fn(
              (
                index: string,
                buildQuery?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
              ) => {
                let version: unknown;
                const query = {
                  eq(field: string, value: unknown) {
                    if (field === "version") version = value;
                    return query;
                  },
                };
                buildQuery?.(query);
                return {
                  unique: vi.fn(async () =>
                    index === "by_package_version"
                      ? releases.find((release) => release.version === version)
                      : null,
                  ),
                  take: vi.fn(async (limit: number) => {
                    packageReleaseTakeLimits.push(limit);
                    return releases.filter((release) => !release.softDeletedAt).slice(0, limit);
                  }),
                  collect: vi.fn(() => {
                    throw new Error("package deletion must not scan release history");
                  }),
                };
              },
            ),
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
  return { actors, audits, ctx, packageReleaseTakeLimits, patches, pkg, releases };
}

function makeTriggerWrappedPackageDeletionCtx(options?: {
  pkg?: Record<string, unknown>;
  releases?: Array<Record<string, unknown>>;
}) {
  vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
  const owner = {
    _id: "users:owner",
    _creationTime: 1,
    role: "user",
    handle: "owner",
    name: "Owner",
    displayName: "Owner",
    createdAt: 1,
    updatedAt: 1,
    deletedAt: undefined,
    deactivatedAt: undefined,
  };
  const releases = options?.releases ?? [
    makePackageRelease("packageReleases:v1", "1.0.0"),
    makePackageRelease("packageReleases:v2", "2.0.0"),
  ];
  const pkg =
    options?.pkg ??
    ({
      _id: "packages:demo",
      _creationTime: 1,
      name: "demo-plugin",
      normalizedName: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      ownerUserId: "users:owner",
      ownerPublisherId: undefined,
      tags: {
        latest: "packageReleases:v2",
        stable: "packageReleases:v2",
        legacy: "packageReleases:v1",
      },
      latestReleaseId: "packageReleases:v2",
      latestVersionSummary: { version: "2.0.0" },
      summary: "2.0.0 summary",
      runtimeId: "runtime.2.0.0",
      sourceRepo: "openclaw/demo-2.0.0",
      capabilityTags: ["cap-2.0.0"],
      executesCode: true,
      compatibility: { openclaw: "^2.0.0" },
      capabilities: {
        capabilityTags: ["cap-2.0.0"],
        executesCode: true,
        runtimeId: "runtime.2.0.0",
      },
      verification: { tier: "community" },
      scanStatus: "clean",
      stats: { downloads: 5, installs: 3, stars: 2, versions: 2 },
      createdAt: 1,
      updatedAt: 20,
      softDeletedAt: undefined,
    } as Record<string, unknown>);
  const docs = new Map<string, Record<string, unknown>>([
    [owner._id, owner],
    [pkg._id as string, pkg],
    ...releases.map((release) => [release._id as string, release] as const),
  ]);
  let insertedCount = 0;
  const packageReleaseTakeLimits: number[] = [];

  function rowsForTable(table: string) {
    return [...docs.values()].filter(
      (row) => typeof row._id === "string" && row._id.startsWith(`${table}:`),
    );
  }

  const db = {
    system: {},
    normalizeId: vi.fn((table: string, id: string) => (id.startsWith(`${table}:`) ? id : null)),
    get: vi.fn(async (arg0: string, arg1?: string) => docs.get(arg1 ?? arg0) ?? null),
    query: vi.fn((table: string) => ({
      withIndex: vi.fn(
        (
          _index: string,
          buildQuery?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
        ) => {
          const filters = new Map<string, unknown>();
          const query = {
            eq(field: string, value: unknown) {
              filters.set(field, value);
              return query;
            },
          };
          buildQuery?.(query);
          const matches = () =>
            rowsForTable(table).filter((row) =>
              [...filters].every(([field, value]) => row[field] === value),
            );
          const collect = vi.fn(async () => {
            if (table === "packageReleases") {
              throw new Error("package deletion path must not collect releases");
            }
            return matches();
          });
          const take = vi.fn(async (limit: number) => {
            if (table === "packageReleases") packageReleaseTakeLimits.push(limit);
            return matches().slice(0, limit);
          });
          const paginate = vi.fn(async () => {
            if (table === "packageReleases") {
              throw new Error("package deletion path must not paginate releases");
            }
            return {
              page: matches(),
              isDone: true,
              continueCursor: "",
            };
          });
          return {
            unique: vi.fn(async () => matches()[0] ?? null),
            collect,
            take,
            paginate,
            order: vi.fn(() => ({ paginate })),
          };
        },
      ),
    })),
    insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
      insertedCount += 1;
      const id = `${table}:inserted-${insertedCount}`;
      docs.set(id, { ...value, _id: id, _creationTime: insertedCount });
      return id;
    }),
    patch: vi.fn(
      async (
        arg0: string,
        arg1: string | Record<string, unknown>,
        arg2?: Record<string, unknown>,
      ) => {
        const id = typeof arg1 === "string" ? arg1 : arg0;
        const patch = typeof arg1 === "string" ? arg2 : arg1;
        if (!patch) throw new Error(`Missing patch for ${id}`);
        const existing = docs.get(id);
        if (!existing) throw new Error(`Missing test document ${id}`);
        docs.set(id, { ...existing, ...patch });
      },
    ),
    replace: vi.fn(
      async (
        arg0: string,
        arg1: string | Record<string, unknown>,
        arg2?: Record<string, unknown>,
      ) => {
        const id = typeof arg1 === "string" ? arg1 : arg0;
        const value = typeof arg1 === "string" ? arg2 : arg1;
        if (!value) throw new Error(`Missing replacement for ${id}`);
        docs.set(id, { ...value, _id: id });
      },
    ),
    delete: vi.fn(async (arg0: string, arg1?: string) => {
      docs.delete(arg1 ?? arg0);
    }),
  };

  return {
    ctx: { db },
    docs,
    packageReleaseTakeLimits,
    pkgId: pkg._id as string,
  };
}

describe("owner skill version deletion", () => {
  it("exports the public mutation contract", () => {
    expect(skillsModule.deleteOwnedVersion).toBeTypeOf("function");
  });

  it("rejects the latestVersionId target before patching", async () => {
    const deleteOwned = getDeletionHelper<{ versionId: string }>(
      skillsModule,
      "deleteOwnedSkillVersionForActor",
    );
    const skill = {
      ...makeSkillDeletionCtx({}).skill,
      tags: {
        latest: "skillVersions:v1",
        stable: "skillVersions:v2",
      },
    };
    const { actors, audits, ctx, patches, skillVersionTakeLimits } = makeSkillDeletionCtx({
      skill,
    });

    await expect(
      deleteOwned(ctx, actors["users:owner"], { versionId: "skillVersions:v2" }),
    ).rejects.toThrow("Publish a replacement version before deleting the current latest version.");
    expect(patches).toEqual([]);
    expect(audits).toEqual([]);
    expect(skillVersionTakeLimits).toEqual([]);
  });

  it("rejects the tags.latest target before patching", async () => {
    const deleteOwned = getDeletionHelper<{ versionId: string }>(
      skillsModule,
      "deleteOwnedSkillVersionForActor",
    );
    const skill = {
      ...makeSkillDeletionCtx({}).skill,
      tags: {
        latest: "skillVersions:v1",
        stable: "skillVersions:v2",
      },
    };
    const { actors, audits, ctx, patches, skillVersionTakeLimits } = makeSkillDeletionCtx({
      skill,
    });

    await expect(
      deleteOwned(ctx, actors["users:owner"], { versionId: "skillVersions:v1" }),
    ).rejects.toThrow("Publish a replacement version before deleting the current latest version.");
    expect(patches).toEqual([]);
    expect(audits).toEqual([]);
    expect(skillVersionTakeLimits).toEqual([]);
  });

  it("deletes a non-latest version with provenance and audit, removes its tags, and preserves latest metadata", async () => {
    const deleteOwned = getDeletionHelper<{ versionId: string }>(
      skillsModule,
      "deleteOwnedSkillVersionForActor",
    );
    const { actors, audits, ctx, patches, skill, skillVersionTakeLimits, versions } =
      makeSkillDeletionCtx({
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
    const parsedBefore = versions[0]?.parsed;

    await deleteOwned(ctx, actors["users:owner"], { versionId: "skillVersions:v1" });

    const ownerDeletedPatch = patches.find(({ id }) => id === "skillVersions:v1")?.patch;
    expect(ownerDeletedPatch).toEqual({
      softDeletedAt: expect.any(Number),
      ownerDeletedAt: expect.any(Number),
      ownerDeletedBy: "users:owner",
    });
    expect(ownerDeletedPatch?.softDeletedAt).toBe(ownerDeletedPatch?.ownerDeletedAt);
    expect(versions[0]?.parsed).toEqual(parsedBefore);
    expect(skill).toMatchObject({
      ...before,
      tags: {
        latest: "skillVersions:v2",
        stable: "skillVersions:v2",
      },
    });
    expect(audits).toContainEqual(
      expect.objectContaining({
        actorUserId: "users:owner",
        action: "skill.version.delete",
        targetType: "skillVersion",
        targetId: "skillVersions:v1",
        metadata: expect.objectContaining({
          skillId: "skills:demo",
          slug: "demo",
          version: "1.0.0",
        }),
      }),
    );
    expect(skillVersionTakeLimits).toEqual([]);
  });

  it("rejects a pointerless sole active skill version with a two-row compatibility read", async () => {
    const deleteOwned = getDeletionHelper<{ versionId: string }>(
      skillsModule,
      "deleteOwnedSkillVersionForActor",
    );
    const onlyVersion = makeSkillVersion("skillVersions:v1", "1.0.0");
    const { actors, audits, ctx, patches, skillVersionTakeLimits } = makeSkillDeletionCtx({
      skill: {
        ...makeSkillDeletionCtx({}).skill,
        latestVersionId: undefined,
        latestVersionSummary: undefined,
        tags: {},
      },
      versions: [onlyVersion],
    });

    await expect(
      deleteOwned(ctx, actors["users:owner"], { versionId: "skillVersions:v1" }),
    ).rejects.toThrow("Publish a replacement version before deleting the current latest version.");
    expect(skillVersionTakeLimits).toEqual([2]);
    expect(patches).toEqual([]);
    expect(audits).toEqual([]);
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

  it("treats a legacy skill without moderationStatus as active", async () => {
    const deleteOwned = getDeletionHelper<{ versionId: string }>(
      skillsModule,
      "deleteOwnedSkillVersionForActor",
    );
    const legacySkill = { ...makeSkillDeletionCtx({}).skill };
    delete legacySkill.moderationStatus;
    const { actors, ctx, patches } = makeSkillDeletionCtx({ skill: legacySkill });

    await expect(
      deleteOwned(ctx, actors["users:owner"], { versionId: "skillVersions:v1" }),
    ).resolves.toMatchObject({ ok: true });
    expect(patches).toContainEqual(
      expect.objectContaining({
        id: "skillVersions:v1",
        patch: expect.objectContaining({ ownerDeletedBy: "users:owner" }),
      }),
    );
  });

  it("rejects an already-unavailable skill version", async () => {
    const deleteOwned = getDeletionHelper<{ versionId: string }>(
      skillsModule,
      "deleteOwnedSkillVersionForActor",
    );
    const unavailable = makeSkillVersion("skillVersions:v2", "2.0.0", {
      softDeletedAt: 30,
      ownerDeletedAt: 30,
      ownerDeletedBy: "users:owner",
    });
    const { actors, ctx, patches } = makeSkillDeletionCtx({
      versions: [makeSkillVersion("skillVersions:v1", "1.0.0"), unavailable],
    });

    await expect(
      deleteOwned(ctx, actors["users:owner"], { versionId: "skillVersions:v2" }),
    ).rejects.toThrow(/already unavailable/i);
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
      deleteOwned(ctx, actors["users:org-admin"], { versionId: "skillVersions:v1" }),
    ).resolves.toMatchObject({ ok: true });
    expect(patches).toContainEqual(
      expect.objectContaining({
        id: "skillVersions:v1",
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

  it("rejects latestReleaseId through the public mutation before patching or reading release history", async () => {
    const { ctx, docs, packageReleaseTakeLimits, pkgId } = makeTriggerWrappedPackageDeletionCtx();
    const pkg = docs.get(pkgId);
    if (!pkg) throw new Error("missing package fixture");
    pkg.tags = {
      latest: "packageReleases:v1",
      stable: "packageReleases:v2",
    };

    await expect(
      deleteOwnedReleaseHandler(ctx, { name: "demo-plugin", version: "2.0.0" }),
    ).rejects.toThrow("Publish a replacement release before deleting the current latest release.");

    expect(docs.get("packageReleases:v2")?.softDeletedAt).toBeUndefined();
    expect(docs.get(pkgId)?.latestReleaseId).toBe("packageReleases:v2");
    expect([...docs.values()].some((row) => row.action === "package.release.delete")).toBe(false);
    expect(packageReleaseTakeLimits).toEqual([]);
  });

  it("rejects a tags.latest release before patching", async () => {
    const deleteOwned = getDeletionHelper<{ name: string; version: string }>(
      packagesModule,
      "deleteOwnedPackageReleaseForActor",
    );
    const pkg = {
      ...makePackageDeletionCtx({}).pkg,
      tags: {
        latest: "packageReleases:v1",
        stable: "packageReleases:v2",
      },
    };
    const { actors, audits, ctx, patches } = makePackageDeletionCtx({ pkg });

    await expect(
      deleteOwned(ctx, actors["users:owner"], { name: "demo-plugin", version: "1.0.0" }),
    ).rejects.toThrow("Publish a replacement release before deleting the current latest release.");
    expect(patches).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("deletes non-latest through the public trigger-wrapped mutation without changing latest metadata", async () => {
    const { ctx, docs, packageReleaseTakeLimits, pkgId } = makeTriggerWrappedPackageDeletionCtx();
    const pkgBefore = docs.get(pkgId);
    const latestBefore = {
      latestReleaseId: pkgBefore?.latestReleaseId,
      latestVersionSummary: pkgBefore?.latestVersionSummary,
      summary: pkgBefore?.summary,
      runtimeId: pkgBefore?.runtimeId,
      sourceRepo: pkgBefore?.sourceRepo,
      capabilityTags: pkgBefore?.capabilityTags,
      executesCode: pkgBefore?.executesCode,
      compatibility: pkgBefore?.compatibility,
      capabilities: pkgBefore?.capabilities,
      verification: pkgBefore?.verification,
      scanStatus: pkgBefore?.scanStatus,
    };

    await deleteOwnedReleaseHandler(ctx, { name: "demo-plugin", version: "1.0.0" });

    expect(docs.get("packageReleases:v1")).toMatchObject({
      softDeletedAt: expect.any(Number),
      ownerDeletedAt: expect.any(Number),
      ownerDeletedBy: "users:owner",
    });
    expect(docs.get(pkgId)).toMatchObject({
      ...latestBefore,
    });
    expect(docs.get(pkgId)?.tags).toEqual({
      latest: "packageReleases:v2",
      stable: "packageReleases:v2",
    });
    expect(packageReleaseTakeLimits).toEqual([]);
  });

  it("deletes a release with provenance and audit while preserving unrelated metadata", async () => {
    const deleteOwned = getDeletionHelper<{ name: string; version: string }>(
      packagesModule,
      "deleteOwnedPackageReleaseForActor",
    );
    const { actors, audits, ctx, packageReleaseTakeLimits, patches, releases } =
      makePackageDeletionCtx({});
    const staticScanBefore = releases[0]?.staticScan;

    await deleteOwned(ctx, actors["users:owner"], { name: "demo-plugin", version: "1.0.0" });

    const ownerDeletedPatch = patches.find(({ id }) => id === "packageReleases:v1")?.patch;
    expect(ownerDeletedPatch).toEqual({
      softDeletedAt: expect.any(Number),
      ownerDeletedAt: expect.any(Number),
      ownerDeletedBy: "users:owner",
    });
    expect(ownerDeletedPatch?.softDeletedAt).toBe(ownerDeletedPatch?.ownerDeletedAt);
    expect(releases[0]?.staticScan).toEqual(staticScanBefore);
    expect(packageReleaseTakeLimits).toEqual([]);
    expect(audits).toContainEqual(
      expect.objectContaining({
        actorUserId: "users:owner",
        action: "package.release.delete",
        targetType: "packageRelease",
        targetId: "packageReleases:v1",
        metadata: expect.objectContaining({
          packageId: "packages:demo",
          name: "demo-plugin",
          version: "1.0.0",
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
      deleteOwned(ctx, actors["users:org-admin"], { name: "demo-plugin", version: "1.0.0" }),
    ).resolves.toMatchObject({ ok: true });
    expect(patches).toContainEqual(
      expect.objectContaining({
        id: "packageReleases:v1",
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

  it("rejects a pointerless sole active release with a two-row compatibility read", async () => {
    const deleteOwned = getDeletionHelper<{ name: string; version: string }>(
      packagesModule,
      "deleteOwnedPackageReleaseForActor",
    );
    const onlyRelease = makePackageRelease("packageReleases:v1", "1.0.0");
    const { actors, audits, ctx, packageReleaseTakeLimits, patches } = makePackageDeletionCtx({
      pkg: {
        ...makePackageDeletionCtx({}).pkg,
        latestReleaseId: undefined,
        latestVersionSummary: undefined,
        tags: {},
      },
      releases: [onlyRelease],
    });

    await expect(
      deleteOwned(ctx, actors["users:owner"], { name: "demo-plugin", version: "1.0.0" }),
    ).rejects.toThrow("Publish a replacement release before deleting the current latest release.");
    expect(packageReleaseTakeLimits).toEqual([2]);
    expect(patches).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("rejects an already-unavailable package release", async () => {
    const deleteOwned = getDeletionHelper<{ name: string; version: string }>(
      packagesModule,
      "deleteOwnedPackageReleaseForActor",
    );
    const unavailable = makePackageRelease("packageReleases:v2", "2.0.0", {
      softDeletedAt: 30,
      ownerDeletedAt: 30,
      ownerDeletedBy: "users:owner",
    });
    const { actors, ctx, patches } = makePackageDeletionCtx({
      releases: [makePackageRelease("packageReleases:v1", "1.0.0"), unavailable],
    });

    await expect(
      deleteOwned(ctx, actors["users:owner"], { name: "demo-plugin", version: "2.0.0" }),
    ).rejects.toThrow(/already unavailable/i);
    expect(patches).toEqual([]);
  });

  it("rejects release deletion when the parent package is inactive", async () => {
    const deleteOwned = getDeletionHelper<{ name: string; version: string }>(
      packagesModule,
      "deleteOwnedPackageReleaseForActor",
    );
    const { actors, ctx, patches } = makePackageDeletionCtx({
      pkg: {
        ...makePackageDeletionCtx({}).pkg,
        softDeletedAt: 30,
      },
    });

    await expect(
      deleteOwned(ctx, actors["users:owner"], { name: "demo-plugin", version: "2.0.0" }),
    ).rejects.toThrow(/package is unavailable/i);
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
