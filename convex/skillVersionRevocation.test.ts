/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { buildSkillVersionRevocationPlan, revokeSkillVersionForUser } from "./skills";

function makeVersion(id: string, version: string, createdAt: number) {
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
    createdAt,
  };
}

function makeSkill() {
  return {
    _id: "skills:demo",
    slug: "demo",
    displayName: "Demo 2.0.0",
    summary: "Description 2.0.0",
    icon: "lucide:2.0.0",
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
    moderationStatus: "hidden",
    moderationReason: "user.banned",
    softDeletedAt: 100,
  };
}

describe("buildSkillVersionRevocationPlan", () => {
  it("moves latest pointers to the highest available replacement without lifting a parent hold", () => {
    const plan = buildSkillVersionRevocationPlan({
      actorUserId: "users:moderator" as never,
      skill: makeSkill() as never,
      target: makeVersion("skillVersions:v2", "2.0.0", 20) as never,
      replacement: makeVersion("skillVersions:v1", "1.0.0", 10) as never,
      reason: "confirmed unsafe artifact",
      now: 200,
    });

    expect(plan.versionPatch).toEqual({
      softDeletedAt: 200,
      manualRevocation: {
        reason: "confirmed unsafe artifact",
        reviewerUserId: "users:moderator",
        revokedAt: 200,
      },
    });
    expect(plan.skillPatch).toMatchObject({
      latestVersionId: "skillVersions:v1",
      displayName: "Demo 1.0.0",
      summary: "Description 1.0.0",
      icon: "lucide:1.0.0",
      tags: {
        latest: "skillVersions:v1",
        legacy: "skillVersions:v1",
      },
    });
    expect(plan.skillPatch).not.toHaveProperty("softDeletedAt");
    expect(plan.skillPatch).not.toHaveProperty("moderationReason");
  });

  it("creates an independent hold when the revoked latest has no available replacement", () => {
    const skill = {
      ...makeSkill(),
      tags: {
        latest: "skillVersions:v2",
        stable: "skillVersions:v2",
      },
    };
    const plan = buildSkillVersionRevocationPlan({
      actorUserId: "users:moderator" as never,
      skill: skill as never,
      target: makeVersion("skillVersions:v2", "2.0.0", 20) as never,
      replacement: null,
      reason: "confirmed unsafe artifact",
      now: 200,
    });

    expect(plan.skillPatch).toMatchObject({
      latestVersionId: undefined,
      latestVersionSummary: undefined,
      tags: {},
      softDeletedAt: 200,
      moderationStatus: "hidden",
      moderationReason: "manual.version_revoked",
      moderationNotes: "confirmed unsafe artifact",
      hiddenAt: 200,
      hiddenBy: "users:moderator",
      manualOverride: undefined,
    });
  });

  it("does not change skill pointers when a non-latest version is revoked", () => {
    const plan = buildSkillVersionRevocationPlan({
      actorUserId: "users:moderator" as never,
      skill: makeSkill() as never,
      target: makeVersion("skillVersions:v1", "1.0.0", 10) as never,
      replacement: null,
      reason: "confirmed unsafe artifact",
      now: 200,
    });

    expect(plan.skillPatch).toEqual({
      tags: {
        latest: "skillVersions:v2",
        stable: "skillVersions:v2",
      },
      updatedAt: 200,
    });
  });
});

describe("revokeSkillVersionForUser", () => {
  it("rejects non-moderator actors before resolving the skill", async () => {
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue({
          _id: "users:publisher",
          role: "user",
          deletedAt: undefined,
          deactivatedAt: undefined,
        }),
      },
    };

    await expect(
      revokeSkillVersionForUser(ctx as never, {
        actorUserId: "users:publisher" as never,
        slug: "demo",
        version: "1.0.0",
        reason: "confirmed unsafe artifact",
      }),
    ).rejects.toThrow("Forbidden");
    expect(ctx.db.get).toHaveBeenCalledTimes(1);
  });

  it("resolves already-hidden skills so their exact versions can be revoked before unban", async () => {
    const hiddenSkill = {
      _id: "skills:hidden",
      slug: "hidden-demo",
      softDeletedAt: 100,
      moderationStatus: "hidden",
      moderationReason: "user.banned",
      tags: {},
    };
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue({
          _id: "users:moderator",
          role: "moderator",
          deletedAt: undefined,
          deactivatedAt: undefined,
        }),
        query: vi.fn((table: string) => {
          if (table === "skills") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn().mockResolvedValue([hiddenSkill]),
              })),
            };
          }
          if (table === "skillSlugAliases") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn().mockResolvedValue([]),
              })),
            };
          }
          if (table === "skillVersions") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(null),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      },
    };

    await expect(
      revokeSkillVersionForUser(ctx as never, {
        actorUserId: "users:moderator" as never,
        slug: "hidden-demo",
        version: "1.0.0",
        reason: "confirmed unsafe artifact",
      }),
    ).rejects.toThrow("Skill version not found");
  });
});
