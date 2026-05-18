/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("./lib/badges", () => ({
  getSkillBadgeMap: vi.fn(),
  getSkillBadgeMaps: vi.fn(),
  isSkillHighlighted: vi.fn(),
}));

const { restoreOwnedPackagesForAutobanRemediationBatchInternal } = await import("./packages");
const {
  recomputeLatestSkillModerationInternal,
  restoreOwnedSkillsForAutobanRemediationBatchInternal,
} = await import("./skills");
const { remediateAutobansInternal } = await import("./users");

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const restoreSkillsHandler = (
  restoreOwnedSkillsForAutobanRemediationBatchInternal as unknown as WrappedHandler<{
    actorUserId: string;
    ownerUserId: string;
    bannedAt: number;
    cursor?: string;
  }>
)._handler;
const recomputeSkillModerationHandler = (
  recomputeLatestSkillModerationInternal as unknown as WrappedHandler<
    { skillId: string },
    { ok: true; skipped?: string }
  >
)._handler;
const restorePackagesHandler = (
  restoreOwnedPackagesForAutobanRemediationBatchInternal as unknown as WrappedHandler<{
    actorUserId: string;
    ownerUserId: string;
    bannedAt: number;
    cursor?: string;
  }>
)._handler;
const remediateAutobansHandler = (
  remediateAutobansInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      targetUserId?: string;
      dryRun?: boolean;
    },
    {
      scanned: number;
      skipped: number;
      items: Array<{
        decision: string;
        skipReason?: string;
        restoredPackages?: number;
        triggers?: Array<Record<string, unknown>>;
      }>;
    }
  >
)._handler;

describe("autoban remediation skill restore", () => {
  it("aborts stale scheduled restore pages when the owner is banned again", async () => {
    const patch = vi.fn();
    const scheduler = { runAfter: vi.fn() };
    const query = vi.fn();

    const result = (await restoreSkillsHandler(
      {
        db: {
          query,
          patch,
          insert: vi.fn(),
          get: vi.fn(async (id: string) =>
            id === "users:target"
              ? { _id: "users:target", deletedAt: 1778569309999, banReason: "malware auto-ban" }
              : null,
          ),
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(() => null),
        },
        scheduler,
      } as never,
      {
        actorUserId: "users:admin",
        ownerUserId: "users:target",
        bannedAt: 1778569308754,
      },
    )) as { restoredCount: number; scheduled: boolean; aborted?: boolean };

    expect(result).toMatchObject({ restoredCount: 0, scheduled: false, aborted: true });
    expect(query).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("does not overwrite an existing non-autoban moderation lock while recomputing", async () => {
    const patch = vi.fn();
    const get = vi.fn(async (id: string) => {
      if (id === "skills:trigger") {
        return {
          _id: "skills:trigger",
          slug: "moderation-hidden-trigger",
          ownerUserId: "users:target",
          latestVersionId: "skillVersions:latest",
          moderationStatus: "hidden",
          moderationReason: "user.moderation",
        };
      }
      throw new Error(`Unexpected get ${id}`);
    });

    const result = await recomputeSkillModerationHandler(
      {
        db: {
          get,
          query: vi.fn(),
          patch,
          insert: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(() => null),
        },
      } as never,
      { skillId: "skills:trigger" },
    );

    expect(result).toEqual({ ok: true, skipped: "existing_lock" });
    expect(get).toHaveBeenCalledTimes(1);
    expect(patch).not.toHaveBeenCalled();
  });

  it("restores all timestamp-matched non-malicious skills, even scanner-reason trigger rows", async () => {
    const patch = vi.fn();
    const insert = vi.fn();
    const scheduler = { runAfter: vi.fn() };
    const skills = [
      {
        _id: "skills:trigger",
        slug: "xpr-network-dev",
        ownerUserId: "users:target",
        softDeletedAt: 1778569308754,
        moderationStatus: "hidden",
        moderationReason: "scanner.vt.clean",
        moderationVerdict: "clean",
        moderationFlags: ["blocked.malware"],
        moderationReasonCodes: ["malicious.vt_malicious"],
        moderationEvaluatedAt: 1778569308755,
        stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "skills:fallout",
        slug: "other-skill",
        ownerUserId: "users:target",
        softDeletedAt: 1778569308754,
        moderationStatus: "hidden",
        moderationReason: "user.banned",
        stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "skills:malicious",
        slug: "still-bad",
        ownerUserId: "users:target",
        softDeletedAt: 1778569308754,
        moderationStatus: "hidden",
        moderationReason: "scanner.aggregate.malicious",
        moderationVerdict: "malicious",
        moderationFlags: ["blocked.malware"],
        stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "skills:legacy-blocked",
        slug: "legacy-blocked",
        ownerUserId: "users:target",
        softDeletedAt: 1778569308754,
        moderationStatus: "hidden",
        moderationReason: "scanner.vt.clean",
        moderationVerdict: "clean",
        moderationFlags: ["blocked.malware"],
        moderationReasonCodes: ["malicious.vt_malicious"],
        stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "skills:moderation-hidden",
        slug: "moderation-hidden",
        ownerUserId: "users:target",
        softDeletedAt: 1778569308754,
        moderationStatus: "hidden",
        moderationReason: "user.moderation",
        hiddenAt: 123,
        hiddenBy: "users:moderator",
        stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const query = vi.fn((table: string) => {
      if (table === "skills") {
        return {
          withIndex: (name: string) => {
            expect(name).toBe("by_owner");
            return {
              order: () => ({
                paginate: vi.fn(async () => ({
                  page: skills,
                  isDone: true,
                  continueCursor: null,
                })),
              }),
            };
          },
        };
      }
      if (table === "globalStats") {
        return { withIndex: () => ({ unique: vi.fn(async () => null) }) };
      }
      if (table === "skillEmbeddings") {
        return { withIndex: () => ({ collect: vi.fn(async () => []) }) };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = (await restoreSkillsHandler(
      {
        db: {
          query,
          patch,
          insert,
          get: vi.fn(async (id: string) =>
            id === "users:target" ? { _id: "users:target", role: "user" } : null,
          ),
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(() => null),
        },
        scheduler,
      } as never,
      {
        actorUserId: "users:admin",
        ownerUserId: "users:target",
        bannedAt: 1778569308754,
      },
    )) as { restoredCount: number; skippedMalicious: number };

    expect(result).toMatchObject({ restoredCount: 3, skippedMalicious: 2 });
    expect(patch).toHaveBeenCalledWith(
      "skills:trigger",
      expect.objectContaining({
        softDeletedAt: undefined,
        moderationStatus: "active",
        moderationFlags: [],
        moderationReasonCodes: undefined,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skills:fallout",
      expect.objectContaining({
        softDeletedAt: undefined,
        moderationStatus: "active",
        moderationReason: "restored.autoban_remediation",
      }),
    );
    expect(patch).not.toHaveBeenCalledWith("skills:malicious", expect.anything());
    expect(patch).not.toHaveBeenCalledWith("skills:legacy-blocked", expect.anything());
    expect(patch).toHaveBeenCalledWith(
      "skills:moderation-hidden",
      expect.objectContaining({
        softDeletedAt: undefined,
        moderationStatus: "hidden",
        moderationReason: "user.moderation",
        hiddenAt: 123,
        hiddenBy: "users:moderator",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "skill.autoban_remediation.restore",
        actorUserId: "users:admin",
        targetId: "skills:trigger",
      }),
    );
  });
});

describe("autoban remediation users", () => {
  it("uses the user row as current ban state and blocks when trigger audit is missing", async () => {
    const query = vi.fn((table: string) => {
      if (table === "auditLogs") {
        return {
          withIndex: () => ({
            collect: vi.fn(async () => []),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const get = vi.fn(async (id: string) => {
      if (id === "users:admin") return { _id: "users:admin", role: "admin" };
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "paulgnz",
          deletedAt: 1778569308754,
          banReason: "malware auto-ban",
        };
      }
      return null;
    });

    const result = await remediateAutobansHandler(
      {
        db: {
          query,
          get,
          patch: vi.fn(),
          insert: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(() => null),
        },
        runQuery: vi.fn(),
        runMutation: vi.fn(),
      } as never,
      { actorUserId: "users:admin", targetUserId: "users:target", dryRun: true },
    );

    expect(result.scanned).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.items[0]).toMatchObject({
      decision: "blocked",
      skipReason: "missing_trigger_audit",
    });
  });

  it("applies since cutoff to targeted remediation", async () => {
    const bannedAt = 1778569308754;
    const get = vi.fn(async (id: string) => {
      if (id === "users:admin") return { _id: "users:admin", role: "admin" };
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "old-ban",
          deletedAt: bannedAt,
          banReason: "malware auto-ban",
        };
      }
      return null;
    });

    const result = await remediateAutobansHandler(
      {
        db: {
          query: vi.fn(),
          get,
          patch: vi.fn(),
          insert: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(() => null),
        },
        runQuery: vi.fn(),
        runMutation: vi.fn(),
      } as never,
      {
        actorUserId: "users:admin",
        targetUserId: "users:target",
        since: new Date(bannedAt + 1).toISOString(),
        dryRun: true,
      } as never,
    );

    expect(result.scanned).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("dry-run counts a clean-preview trigger skill even when persisted flags are stale malicious", async () => {
    const bannedAt = 1778569308754;
    const triggerSkill = {
      _id: "skills:trigger",
      slug: "false-positive",
      ownerUserId: "users:target",
      softDeletedAt: bannedAt,
      moderationStatus: "hidden",
      moderationReason: "scanner.vt.malicious",
      moderationVerdict: "malicious",
      moderationFlags: ["blocked.malware"],
      moderationReasonCodes: ["malicious.vt_malicious"],
    };
    const query = vi.fn((table: string) => {
      if (table === "auditLogs") {
        return {
          withIndex: () => ({
            collect: vi.fn(async () => [
              {
                action: "user.autoban.malware",
                createdAt: bannedAt,
                metadata: { slug: "false-positive", trigger: "vt.malicious" },
              },
            ]),
          }),
        };
      }
      if (table === "skills") {
        return {
          withIndex: (name: string) => {
            if (name === "by_slug") return { unique: vi.fn(async () => triggerSkill) };
            if (name === "by_owner") {
              return {
                order: () => ({
                  paginate: vi.fn(async () => ({
                    page: [triggerSkill],
                    isDone: true,
                    continueCursor: null,
                  })),
                }),
              };
            }
            throw new Error(`Unexpected skills index ${name}`);
          },
        };
      }
      if (table === "packages") {
        return {
          withIndex: (name: string) => {
            if (name === "by_owner") {
              return {
                order: () => ({
                  paginate: vi.fn(async () => ({
                    page: [],
                    isDone: true,
                    continueCursor: null,
                  })),
                }),
              };
            }
            throw new Error(`Unexpected packages index ${name}`);
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const get = vi.fn(async (id: string) => {
      if (id === "users:admin") return { _id: "users:admin", role: "admin" };
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "false-positive-owner",
          deletedAt: bannedAt,
          banReason: "malware auto-ban",
        };
      }
      return null;
    });
    const runMutation = vi.fn();

    const result = await remediateAutobansHandler(
      {
        db: {
          query,
          get,
          patch: vi.fn(),
          insert: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(() => null),
        },
        runQuery: vi.fn(async () => ({
          verdict: "clean",
          reason: "scanner.aggregate.clean",
          reasonCodes: [],
        })),
        runMutation,
      } as never,
      { actorUserId: "users:admin", targetUserId: "users:target", dryRun: true },
    );

    expect(result.items[0]).toMatchObject({
      decision: "would_unban",
      restoredSkills: 1,
      triggers: [
        expect.objectContaining({
          artifactKind: "skill",
          artifactId: "skills:trigger",
          verdict: "clean",
        }),
      ],
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("blocks pending trigger skill scans even when the preview verdict is clean", async () => {
    const bannedAt = 1778569308754;
    const triggerSkill = {
      _id: "skills:trigger",
      slug: "pending-trigger",
      ownerUserId: "users:target",
      softDeletedAt: bannedAt,
      moderationStatus: "hidden",
      moderationReason: "scanner.vt.malicious",
      moderationVerdict: "malicious",
      moderationFlags: ["blocked.malware"],
    };
    const query = vi.fn((table: string) => {
      if (table === "auditLogs") {
        return {
          withIndex: () => ({
            collect: vi.fn(async () => [
              {
                action: "user.autoban.malware",
                createdAt: bannedAt,
                metadata: { slug: "pending-trigger", trigger: "vt.malicious" },
              },
            ]),
          }),
        };
      }
      if (table === "skills") {
        return {
          withIndex: (name: string) => {
            if (name === "by_slug") return { unique: vi.fn(async () => triggerSkill) };
            throw new Error(`Unexpected skills index ${name}`);
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const get = vi.fn(async (id: string) => {
      if (id === "users:admin") return { _id: "users:admin", role: "admin" };
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "pending-owner",
          deletedAt: bannedAt,
          banReason: "malware auto-ban",
        };
      }
      return null;
    });

    const result = await remediateAutobansHandler(
      {
        db: {
          query,
          get,
          patch: vi.fn(),
          insert: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(() => null),
        },
        runQuery: vi.fn(async () => ({
          verdict: "clean",
          reason: "scanner.vt.pending",
          reasonCodes: [],
        })),
        runMutation: vi.fn(),
      } as never,
      { actorUserId: "users:admin", targetUserId: "users:target", dryRun: true },
    );

    expect(result.items[0]).toMatchObject({
      decision: "blocked",
      skipReason: "trigger_not_non_malicious",
      triggers: [
        expect.objectContaining({
          artifactKind: "skill",
          artifactId: "skills:trigger",
          verdict: "clean",
          reason: "scanner.vt.pending",
        }),
      ],
    });
  });

  it("blocks package trigger audits without a current non-malicious verdict", async () => {
    const bannedAt = 1778569308754;
    const query = vi.fn((table: string) => {
      if (table === "auditLogs") {
        return {
          withIndex: () => ({
            collect: vi.fn(async () => [
              {
                action: "user.autoban.malware",
                createdAt: bannedAt,
                metadata: { packageName: "@scope/demo", trigger: "vt.malicious" },
              },
            ]),
          }),
        };
      }
      if (table === "skills") {
        return {
          withIndex: (name: string) => {
            if (name === "by_slug") return { unique: vi.fn(async () => null) };
            throw new Error(`Unexpected skills index ${name}`);
          },
        };
      }
      if (table === "packages") {
        return {
          withIndex: (name: string) => {
            if (name === "by_name") {
              return {
                unique: vi.fn(async () => ({
                  _id: "packages:demo",
                  name: "@scope/demo",
                  normalizedName: "@scope/demo",
                  ownerUserId: "users:target",
                })),
              };
            }
            throw new Error(`Unexpected packages index ${name}`);
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const get = vi.fn(async (id: string) => {
      if (id === "users:admin") return { _id: "users:admin", role: "admin" };
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "plugin-owner",
          deletedAt: bannedAt,
          banReason: "malware auto-ban",
        };
      }
      return null;
    });

    const result = await remediateAutobansHandler(
      {
        db: {
          query,
          get,
          patch: vi.fn(),
          insert: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(() => null),
        },
        runQuery: vi.fn(),
        runMutation: vi.fn(),
      } as never,
      { actorUserId: "users:admin", targetUserId: "users:target", dryRun: true },
    );

    expect(result.items[0]).toMatchObject({
      decision: "blocked",
      skipReason: "trigger_not_non_malicious",
      triggers: [
        expect.objectContaining({
          artifactKind: "package",
          artifactId: "packages:demo",
          verdict: null,
        }),
      ],
    });
  });

  it("evaluates package trigger audits as non-malicious restore candidates", async () => {
    const bannedAt = 1778569308754;
    const query = vi.fn((table: string) => {
      if (table === "auditLogs") {
        return {
          withIndex: () => ({
            collect: vi.fn(async () => [
              {
                action: "user.autoban.malware",
                createdAt: bannedAt,
                metadata: { packageName: "@scope/demo", trigger: "vt.malicious" },
              },
            ]),
          }),
        };
      }
      if (table === "skills") {
        return {
          withIndex: (name: string) => {
            if (name === "by_slug") return { unique: vi.fn(async () => null) };
            if (name === "by_owner") {
              return {
                order: () => ({
                  paginate: vi.fn(async () => ({
                    page: [],
                    isDone: true,
                    continueCursor: null,
                  })),
                }),
              };
            }
            throw new Error(`Unexpected skills index ${name}`);
          },
        };
      }
      if (table === "packages") {
        return {
          withIndex: (name: string) => {
            if (name === "by_name") {
              return {
                unique: vi.fn(async () => ({
                  _id: "packages:demo",
                  name: "@scope/demo",
                  normalizedName: "@scope/demo",
                  ownerUserId: "users:target",
                  scanStatus: "clean",
                })),
              };
            }
            if (name === "by_owner") {
              return {
                order: () => ({
                  paginate: vi.fn(async () => ({
                    page: [
                      {
                        _id: "packages:demo",
                        ownerUserId: "users:target",
                        softDeletedAt: bannedAt,
                      },
                      {
                        _id: "packages:malicious",
                        ownerUserId: "users:target",
                        softDeletedAt: bannedAt,
                        scanStatus: "malicious",
                      },
                    ],
                    isDone: true,
                    continueCursor: null,
                  })),
                }),
              };
            }
            throw new Error(`Unexpected packages index ${name}`);
          },
        };
      }
      if (table === "packageReleases") {
        return {
          withIndex: () => ({
            paginate: vi.fn(async () => ({
              page: [
                {
                  _id: "packageReleases:demo",
                  packageId: "packages:demo",
                  softDeletedAt: bannedAt,
                  llmAnalysis: { status: "clean" },
                },
              ],
              isDone: true,
              continueCursor: null,
            })),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const get = vi.fn(async (id: string) => {
      if (id === "users:admin") return { _id: "users:admin", role: "admin" };
      if (id === "users:target") {
        return {
          _id: "users:target",
          role: "user",
          handle: "plugin-owner",
          deletedAt: bannedAt,
          banReason: "malware auto-ban",
        };
      }
      return null;
    });

    const result = await remediateAutobansHandler(
      {
        db: {
          query,
          get,
          patch: vi.fn(),
          insert: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(() => null),
        },
        runQuery: vi.fn(),
        runMutation: vi.fn(),
      } as never,
      { actorUserId: "users:admin", targetUserId: "users:target", dryRun: true },
    );

    expect(result.items[0]).toMatchObject({
      decision: "would_unban",
      restoredPackages: 1,
      triggers: [
        expect.objectContaining({
          artifactKind: "package",
          artifactId: "packages:demo",
          verdict: "clean",
        }),
      ],
    });
  });
});

describe("autoban remediation package restore", () => {
  it("adds latest distTag when falling back to a non-malicious restored release", async () => {
    const bannedAt = 1778569308754;
    const patch = vi.fn();
    const insert = vi.fn();
    const scheduler = { runAfter: vi.fn() };
    const query = vi.fn((table: string) => {
      if (table === "packages") {
        return {
          withIndex: (name: string) => {
            expect(name).toBe("by_owner");
            return {
              order: () => ({
                paginate: vi.fn(async () => ({
                  page: [
                    {
                      _id: "packages:demo",
                      name: "@scope/demo",
                      normalizedName: "@scope/demo",
                      displayName: "@scope/demo",
                      family: "external-code-plugin",
                      ownerUserId: "users:target",
                      softDeletedAt: bannedAt,
                      scanStatus: "clean",
                      tags: { latest: "packageReleases:bad" },
                      latestReleaseId: "packageReleases:bad",
                      stats: {},
                      compatibility: {},
                      capabilities: {},
                      verification: {},
                      isOfficial: false,
                      createdAt: 1,
                      updatedAt: 1,
                    },
                  ],
                  isDone: true,
                  continueCursor: null,
                })),
              }),
            };
          },
        };
      }
      if (table === "packageReleases") {
        return {
          withIndex: (name: string) => {
            if (name === "by_package") {
              return {
                collect: vi.fn(async () => [
                  {
                    _id: "packageReleases:bad",
                    packageId: "packages:demo",
                    version: "2.0.0",
                    changelog: "",
                    integritySha256: "bad-sha",
                    compatibility: {},
                    capabilities: {},
                    verification: {},
                    softDeletedAt: bannedAt,
                    staticScan: { status: "malicious" },
                    distTags: ["latest"],
                    createdAt: 2,
                  },
                  {
                    _id: "packageReleases:good",
                    packageId: "packages:demo",
                    version: "1.0.0",
                    changelog: "",
                    integritySha256: "good-sha",
                    compatibility: {},
                    capabilities: {},
                    verification: {},
                    softDeletedAt: bannedAt,
                    llmAnalysis: { status: "clean" },
                    distTags: [],
                    createdAt: 1,
                  },
                ]),
              };
            }
            throw new Error(`Unexpected packageReleases index ${name}`);
          },
        };
      }
      if (
        table === "packageSearchDigest" ||
        table === "packageCapabilitySearchDigest" ||
        table === "packagePluginCategorySearchDigest"
      ) {
        return {
          withIndex: () => ({
            unique: vi.fn(async () => null),
            collect: vi.fn(async () => []),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = (await restorePackagesHandler(
      {
        db: {
          query,
          patch,
          insert,
          get: vi.fn(async (id: string) =>
            id === "users:target" ? { _id: "users:target", role: "user" } : null,
          ),
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(() => null),
        },
        scheduler,
      } as never,
      {
        actorUserId: "users:admin",
        ownerUserId: "users:target",
        bannedAt,
      },
    )) as { restoredCount: number; restoredReleases: number; skippedMalicious: number };

    expect(result).toMatchObject({
      restoredCount: 1,
      restoredReleases: 1,
      skippedMalicious: 0,
    });
    expect(patch).toHaveBeenCalledWith("packageReleases:good", { softDeletedAt: undefined });
    expect(patch).toHaveBeenCalledWith("packageReleases:good", { distTags: ["latest"] });
    expect(patch).toHaveBeenCalledWith(
      "packages:demo",
      expect.objectContaining({
        softDeletedAt: undefined,
        latestReleaseId: "packageReleases:good",
        tags: { latest: "packageReleases:good" },
      }),
    );
    expect(patch).not.toHaveBeenCalledWith("packageReleases:bad", expect.anything());
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "package.autoban_remediation.restore",
        targetId: "packages:demo",
      }),
    );
  });

  it("skips timestamp-matched packages when no non-malicious release can be selected", async () => {
    const bannedAt = 1778569308754;
    const patch = vi.fn();
    const scheduler = { runAfter: vi.fn() };
    const query = vi.fn((table: string) => {
      if (table === "packages") {
        return {
          withIndex: (name: string) => {
            expect(name).toBe("by_owner");
            return {
              order: () => ({
                paginate: vi.fn(async () => ({
                  page: [
                    {
                      _id: "packages:demo",
                      name: "@scope/demo",
                      normalizedName: "@scope/demo",
                      family: "external-code-plugin",
                      ownerUserId: "users:target",
                      softDeletedAt: bannedAt,
                      scanStatus: "clean",
                      tags: {},
                    },
                  ],
                  isDone: true,
                  continueCursor: null,
                })),
              }),
            };
          },
        };
      }
      if (table === "packageReleases") {
        return {
          withIndex: (name: string) => {
            expect(name).toBe("by_package");
            return {
              collect: vi.fn(async () => [
                {
                  _id: "packageReleases:demo",
                  packageId: "packages:demo",
                  version: "1.0.0",
                  softDeletedAt: bannedAt,
                  staticScan: { status: "malicious" },
                  distTags: ["latest"],
                },
              ]),
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = (await restorePackagesHandler(
      {
        db: {
          query,
          patch,
          insert: vi.fn(),
          get: vi.fn(async (id: string) =>
            id === "users:target" ? { _id: "users:target", role: "user" } : null,
          ),
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(() => null),
        },
        scheduler,
      } as never,
      {
        actorUserId: "users:admin",
        ownerUserId: "users:target",
        bannedAt,
      },
    )) as { restoredCount: number; restoredReleases: number; skippedMalicious: number };

    expect(result).toMatchObject({
      restoredCount: 0,
      restoredReleases: 0,
      skippedMalicious: 1,
    });
    expect(patch).not.toHaveBeenCalled();
  });
});
