/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { skillVersionPageToLatestExportRows } from "./securityDataset";

describe("security dataset export", () => {
  it("exports only each skill's latest active version", async () => {
    const get = vi.fn(async (id: string) => {
      if (id === "skills:demo") {
        return makeSkill({
          id,
          latestVersionId: "skillVersions:latest",
          moderationSourceVersionId: "skillVersions:old",
        });
      }
      if (id === "publishers:owner") {
        return {
          _id: id,
          handle: "owner",
          deletedAt: undefined,
          deactivatedAt: undefined,
        };
      }
      throw new Error(`unexpected db.get(${id})`);
    });

    const rows = await skillVersionPageToLatestExportRows(
      { db: { get } } as never,
      [
        makeVersion({ id: "skillVersions:old", version: "1.0.0" }),
        makeVersion({ id: "skillVersions:latest", version: "2.0.0" }),
      ] as never,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceDocId: "skillVersions:latest",
      parentDocId: "skills:demo",
      publicOwnerHandle: "owner",
      publicSlug: "demo",
      version: "2.0.0",
      moderationConsensus: null,
    });
  });

  it("skips skills without an active latest version", async () => {
    const get = vi.fn(async (id: string) => {
      if (id === "skills:missing-latest") {
        return makeSkill({ id, latestVersionId: undefined });
      }
      if (id === "skills:other-latest") {
        return makeSkill({ id, latestVersionId: "skillVersions:other" });
      }
      if (id === "skills:deleted") {
        return makeSkill({ id, latestVersionId: "skillVersions:deleted", softDeletedAt: 123 });
      }
      return null;
    });

    const rows = await skillVersionPageToLatestExportRows(
      { db: { get } } as never,
      [
        makeVersion({ id: "skillVersions:missing-latest", skillId: "skills:missing-latest" }),
        makeVersion({ id: "skillVersions:not-latest", skillId: "skills:other-latest" }),
        makeVersion({ id: "skillVersions:deleted", skillId: "skills:deleted" }),
        makeVersion({ id: "skillVersions:missing-skill", skillId: "skills:missing" }),
      ] as never,
    );

    expect(rows).toEqual([]);
  });
});

function makeSkill(input: {
  id: string;
  latestVersionId: string | undefined;
  moderationSourceVersionId?: string;
  softDeletedAt?: number;
}) {
  return {
    _id: input.id,
    slug: "demo",
    displayName: "Demo",
    ownerPublisherId: "publishers:owner",
    ownerUserId: "users:owner",
    latestVersionId: input.latestVersionId,
    moderationSourceVersionId: input.moderationSourceVersionId,
    moderationVerdict: "clean",
    moderationReasonCodes: [],
    moderationSummary: "Clean",
    moderationEngineVersion: "test",
    moderationEvaluatedAt: 1,
    softDeletedAt: input.softDeletedAt,
  };
}

function makeVersion(input: {
  id: string;
  version?: string;
  softDeletedAt?: number;
  skillId?: string;
}) {
  return {
    _id: input.id,
    skillId: input.skillId ?? "skills:demo",
    version: input.version ?? "1.0.0",
    createdAt: 2,
    softDeletedAt: input.softDeletedAt,
    sha256hash: "a".repeat(64),
    files: [],
    vtAnalysis: undefined,
    skillSpectorAnalysis: undefined,
    staticScan: undefined,
    llmAnalysis: undefined,
  };
}
