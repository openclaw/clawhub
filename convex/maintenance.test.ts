/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

vi.mock("./_generated/api", () => ({
  internal: {
    maintenance: {
      getSkillBackfillPageInternal: Symbol("getSkillBackfillPageInternal"),
      applySkillBackfillPatchInternal: Symbol("applySkillBackfillPatchInternal"),
      backfillSkillSummariesInternal: Symbol("backfillSkillSummariesInternal"),
      getUserStatsBackfillPageInternal: Symbol("getUserStatsBackfillPageInternal"),
      getUserOwnedSkillsBackfillPageInternal: Symbol("getUserOwnedSkillsBackfillPageInternal"),
      applyUserStatsBackfillPatchInternal: Symbol("applyUserStatsBackfillPatchInternal"),
      backfillUserStatsInternal: Symbol("backfillUserStatsInternal"),
      getSkillFingerprintBackfillPageInternal: Symbol("getSkillFingerprintBackfillPageInternal"),
      applySkillFingerprintBackfillPatchInternal: Symbol(
        "applySkillFingerprintBackfillPatchInternal",
      ),
      backfillSkillFingerprintsInternal: Symbol("backfillSkillFingerprintsInternal"),
      applySkillCapabilityTagsInternal: Symbol("applySkillCapabilityTagsInternal"),
      backfillSkillCapabilityTagsInternal: Symbol("backfillSkillCapabilityTagsInternal"),
      getEmptySkillCleanupPageInternal: Symbol("getEmptySkillCleanupPageInternal"),
      applyEmptySkillCleanupInternal: Symbol("applyEmptySkillCleanupInternal"),
      nominateUserForEmptySkillSpamInternal: Symbol("nominateUserForEmptySkillSpamInternal"),
      cleanupEmptySkillsInternal: Symbol("cleanupEmptySkillsInternal"),
      nominateEmptySkillSpammersInternal: Symbol("nominateEmptySkillSpammersInternal"),
    },
    skills: {
      backfillLatestSkillModerationInternal: Symbol("skills.backfillLatestSkillModerationInternal"),
      getVersionByIdInternal: Symbol("skills.getVersionByIdInternal"),
      getOwnerSkillActivityInternal: Symbol("skills.getOwnerSkillActivityInternal"),
    },
    users: {
      getByIdInternal: Symbol("users.getByIdInternal"),
    },
  },
}));

vi.mock("./lib/skillSummary", () => ({
  generateSkillSummary: vi.fn(),
}));

const {
  applySkillCapabilityTagsInternal,
  backfillLatestVersionSummaryInternal,
  backfillSkillFingerprintsInternalHandler,
  backfillSkillSummariesInternalHandler,
  backfillUserStatsInternalHandler,
  cleanupLegacySuspiciousDigestFieldsInternal,
  cleanupLegacySuspiciousSkillFieldsInternal,
  cleanupEmptySkillsInternalHandler,
  nominateEmptySkillSpammersInternalHandler,
  upsertSkillBadgeRecordInternal,
} = await import("./maintenance");
const { internal } = await import("./_generated/api");
const { generateSkillSummary } = await import("./lib/skillSummary");

function makeBlob(text: string) {
  return { text: () => Promise.resolve(text) } as unknown as Blob;
}

describe("maintenance backfill", () => {
  it("repairs summary + parsed by reparsing SKILL.md", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          kind: "ok",
          skillId: "skills:1",
          skillSlug: "skill-1",
          skillDisplayName: "Skill 1",
          versionId: "skillVersions:1",
          skillSummary: ">",
          versionParsed: { frontmatter: { description: ">" } },
          readmeStorageId: "storage:1",
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn().mockResolvedValue({ ok: true });
    const storageGet = vi
      .fn()
      .mockResolvedValue(makeBlob(`---\ndescription: >\n  Hello\n  world.\n---\nBody`));

    const result = await backfillSkillSummariesInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.skillsScanned).toBe(1);
    expect(result.stats.skillsPatched).toBe(1);
    expect(result.stats.versionsPatched).toBe(1);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      skillId: "skills:1",
      versionId: "skillVersions:1",
      summary: "Hello world.",
      parsed: {
        frontmatter: { description: "Hello world." },
        metadata: undefined,
        clawdis: undefined,
        license: "MIT-0",
      },
    });
  });

  it("dryRun does not patch", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          kind: "ok",
          skillId: "skills:1",
          skillSlug: "skill-1",
          skillDisplayName: "Skill 1",
          versionId: "skillVersions:1",
          skillSummary: ">",
          versionParsed: { frontmatter: { description: ">" } },
          readmeStorageId: "storage:1",
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn();
    const storageGet = vi.fn().mockResolvedValue(makeBlob(`---\ndescription: Hello\n---\nBody`));

    const result = await backfillSkillSummariesInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: true, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.skillsPatched).toBe(1);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("counts missing storage blob", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          kind: "ok",
          skillId: "skills:1",
          skillSlug: "skill-1",
          skillDisplayName: "Skill 1",
          versionId: "skillVersions:1",
          skillSummary: null,
          versionParsed: { frontmatter: {} },
          readmeStorageId: "storage:missing",
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn();
    const storageGet = vi.fn().mockResolvedValue(null);

    const result = await backfillSkillSummariesInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.stats.missingStorageBlob).toBe(1);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("fills empty summary via AI when useAi is enabled", async () => {
    vi.mocked(generateSkillSummary).mockResolvedValue("AI generated summary.");

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          kind: "ok",
          skillId: "skills:1",
          skillSlug: "ai-skill",
          skillDisplayName: "AI Skill",
          versionId: "skillVersions:1",
          skillSummary: null,
          versionParsed: { frontmatter: {} },
          readmeStorageId: "storage:1",
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn().mockResolvedValue({ ok: true });
    const storageGet = vi.fn().mockResolvedValue(makeBlob("# AI Skill\n\nUseful automation."));

    const result = await backfillSkillSummariesInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1, useAi: true },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.skillsPatched).toBe(1);
    expect(result.stats.aiSummariesPatched).toBe(1);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      skillId: "skills:1",
      versionId: "skillVersions:1",
      summary: "AI generated summary.",
      parsed: {
        frontmatter: {},
        metadata: undefined,
        clawdis: undefined,
        license: "MIT-0",
      },
    });
  });

  it("re-syncs latestVersionSummary when changelogSource or clawdis drift", async () => {
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "skills:1",
          latestVersionId: "skillVersions:1",
          latestVersionSummary: {
            version: "1.0.0",
            createdAt: 123,
            changelog: "Same changelog",
            changelogSource: "user",
            clawdis: undefined,
          },
        },
      ],
      continueCursor: null,
      isDone: true,
    });
    const get = vi.fn().mockResolvedValue({
      _id: "skillVersions:1",
      version: "1.0.0",
      createdAt: 123,
      changelog: "Same changelog",
      changelogSource: "auto",
      parsed: { clawdis: { emoji: "lobster" } },
    });
    const patch = vi.fn().mockResolvedValue(undefined);
    const runAfter = vi.fn();

    const ctx = {
      db: {
        query: vi.fn(() => ({ paginate })),
        get,
        patch,
        normalizeId: vi.fn(),
      },
      scheduler: {
        runAfter,
      },
    } as never;

    const result = await (
      backfillLatestVersionSummaryInternal as unknown as { _handler: Function }
    )._handler(ctx, {
      batchSize: 10,
    });

    expect(result).toEqual({ patched: 1, isDone: true, scanned: 1 });
    expect(paginate).toHaveBeenCalledWith({ cursor: null, numItems: 10 });
    expect(patch).toHaveBeenCalledWith("skills:1", {
      latestVersionSummary: {
        version: "1.0.0",
        createdAt: 123,
        changelog: "Same changelog",
        changelogSource: "auto",
        clawdis: { emoji: "lobster" },
      },
    });
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("does not reactivate legacy malicious skill rows during suspicious cleanup", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "skills:malicious",
          isSuspicious: true,
          moderationFlags: ["flagged.suspicious"],
          moderationReason: "scanner.llm.malicious",
          moderationReasonCodes: ["malicious.llm_malicious"],
          moderationVerdict: "clean",
          moderationStatus: "hidden",
          softDeletedAt: undefined,
          hiddenAt: now - 1,
          hiddenBy: undefined,
          lastReviewedAt: now - 1,
        },
      ],
      continueCursor: null,
      isDone: true,
    });
    const patch = vi.fn().mockResolvedValue(undefined);

    const result = await (
      cleanupLegacySuspiciousSkillFieldsInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          query: vi.fn(() => ({ paginate })),
          get: vi.fn(),
          insert: vi.fn(),
          patch,
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
        },
        scheduler: { runAfter: vi.fn() },
      } as never,
      { batchSize: 10 },
    );

    expect(result).toEqual({ patched: 1, isDone: true, scanned: 1 });
    const skillPatch = patch.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(skillPatch).toEqual(
      expect.objectContaining({
        isSuspicious: undefined,
        moderationFlags: undefined,
        updatedAt: now,
      }),
    );
    expect(skillPatch).not.toHaveProperty("moderationStatus");
    expect(skillPatch).not.toHaveProperty("hiddenAt");
    expect(skillPatch).not.toHaveProperty("lastReviewedAt");
  });

  it("reactivates legacy suspicious skill rows identified only by structured reason codes", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "skills:suspicious-code",
          isSuspicious: true,
          moderationFlags: undefined,
          moderationReason: undefined,
          moderationReasonCodes: ["suspicious.dynamic_code_execution"],
          moderationVerdict: "clean",
          moderationStatus: "hidden",
          softDeletedAt: undefined,
          hiddenAt: now - 1,
          hiddenBy: undefined,
          lastReviewedAt: now - 1,
        },
      ],
      continueCursor: null,
      isDone: true,
    });
    const patch = vi.fn().mockResolvedValue(undefined);

    const result = await (
      cleanupLegacySuspiciousSkillFieldsInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          query: vi.fn(() => ({ paginate })),
          get: vi.fn(),
          insert: vi.fn(),
          patch,
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
        },
        scheduler: { runAfter: vi.fn() },
      } as never,
      { batchSize: 10 },
    );

    expect(result).toEqual({ patched: 1, isDone: true, scanned: 1 });
    expect(patch).toHaveBeenCalledWith(
      "skills:suspicious-code",
      expect.objectContaining({
        isSuspicious: undefined,
        moderationReasonCodes: undefined,
        moderationStatus: "active",
        hiddenAt: undefined,
        lastReviewedAt: undefined,
        updatedAt: now,
      }),
    );
  });

  it("does not reactivate legacy malicious digest rows during suspicious cleanup", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "skillSearchDigest:malicious",
          isSuspicious: true,
          moderationFlags: ["flagged.suspicious"],
          moderationReason: "scanner.llm.malicious",
          moderationStatus: "hidden",
          softDeletedAt: undefined,
        },
      ],
      continueCursor: null,
      isDone: true,
    });
    const patch = vi.fn().mockResolvedValue(undefined);

    const result = await (
      cleanupLegacySuspiciousDigestFieldsInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          query: vi.fn(() => ({ paginate })),
          get: vi.fn(),
          insert: vi.fn(),
          patch,
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
        },
        scheduler: { runAfter: vi.fn() },
      } as never,
      { batchSize: 10 },
    );

    expect(result).toEqual({ patched: 1, isDone: true, scanned: 1 });
    const digestPatch = patch.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(digestPatch).toEqual(
      expect.objectContaining({
        isSuspicious: undefined,
        moderationFlags: undefined,
        updatedAt: now,
      }),
    );
    expect(digestPatch).not.toHaveProperty("moderationStatus");
  });

  it("does not reactivate pending scan skill rows during suspicious cleanup", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "skills:pending",
          isSuspicious: true,
          moderationFlags: undefined,
          moderationReason: "pending.scan",
          moderationReasonCodes: undefined,
          moderationVerdict: "clean",
          moderationStatus: "hidden",
          softDeletedAt: undefined,
          hiddenAt: now - 1,
          hiddenBy: undefined,
          lastReviewedAt: now - 1,
        },
      ],
      continueCursor: null,
      isDone: true,
    });
    const patch = vi.fn().mockResolvedValue(undefined);

    const result = await (
      cleanupLegacySuspiciousSkillFieldsInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          query: vi.fn(() => ({ paginate })),
          get: vi.fn(),
          insert: vi.fn(),
          patch,
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
        },
        scheduler: { runAfter: vi.fn() },
      } as never,
      { batchSize: 10 },
    );

    expect(result).toEqual({ patched: 1, isDone: true, scanned: 1 });
    expect(patch).toHaveBeenCalledWith(
      "skills:pending",
      expect.objectContaining({
        isSuspicious: undefined,
        updatedAt: now,
      }),
    );
    const skillPatch = patch.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(skillPatch).not.toHaveProperty("moderationStatus");
    expect(skillPatch).not.toHaveProperty("hiddenAt");
    expect(skillPatch).not.toHaveProperty("lastReviewedAt");
  });

  it("does not reactivate pending scan digest rows during suspicious cleanup", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "skillSearchDigest:pending",
          isSuspicious: true,
          moderationFlags: undefined,
          moderationReason: "pending.scan",
          moderationStatus: "hidden",
          softDeletedAt: undefined,
        },
      ],
      continueCursor: null,
      isDone: true,
    });
    const patch = vi.fn().mockResolvedValue(undefined);

    const result = await (
      cleanupLegacySuspiciousDigestFieldsInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          query: vi.fn(() => ({ paginate })),
          get: vi.fn(),
          insert: vi.fn(),
          patch,
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
        },
        scheduler: { runAfter: vi.fn() },
      } as never,
      { batchSize: 10 },
    );

    expect(result).toEqual({ patched: 1, isDone: true, scanned: 1 });
    expect(patch).toHaveBeenCalledWith(
      "skillSearchDigest:pending",
      expect.objectContaining({
        isSuspicious: undefined,
        updatedAt: now,
      }),
    );
    const digestPatch = patch.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(digestPatch).not.toHaveProperty("moderationStatus");
  });

  it("backfills denormalized user hover stats from indexed owner pages", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ _id: "users:1" }],
        cursor: null,
        isDone: true,
      })
      .mockResolvedValueOnce({
        items: [
          { stats: { stars: 4, downloads: 30 }, softDeletedAt: undefined },
          { stats: { stars: 2, downloads: 10 }, softDeletedAt: 123 },
          { stats: { stars: 1, downloads: 5 }, softDeletedAt: undefined },
        ],
        cursor: null,
        isDone: true,
      });
    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    const result = await backfillUserStatsInternalHandler({ runQuery, runMutation } as never, {
      batchSize: 10,
      skillBatchSize: 50,
      maxBatches: 1,
    });

    expect(result).toEqual({
      ok: true,
      stats: {
        usersScanned: 1,
        usersPatched: 1,
      },
      isDone: true,
      cursor: null,
    });
    expect(runQuery).toHaveBeenNthCalledWith(
      1,
      internal.maintenance.getUserStatsBackfillPageInternal,
      {
        cursor: undefined,
        batchSize: 10,
      },
    );
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      internal.maintenance.getUserOwnedSkillsBackfillPageInternal,
      {
        ownerUserId: "users:1",
        cursor: undefined,
        batchSize: 50,
      },
    );
    expect(runMutation).toHaveBeenCalledWith(
      internal.maintenance.applyUserStatsBackfillPatchInternal,
      {
        userId: "users:1",
        publishedSkills: 2,
        totalStars: 5,
        totalDownloads: 35,
      },
    );
  });
});

describe("maintenance badge denormalization", () => {
  it("upserts table badge and keeps skill.badges in sync", async () => {
    const unique = vi.fn().mockResolvedValue(null);
    const query = vi.fn().mockReturnValue({
      withIndex: () => ({ unique }),
    });
    const insert = vi.fn().mockResolvedValue("skillBadges:1");
    const get = vi.fn().mockResolvedValue({ _id: "skills:1", badges: undefined });
    const patch = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      db: {
        query,
        insert,
        get,
        patch,
        normalizeId: vi.fn(),
      },
    } as never;

    const result = await (
      upsertSkillBadgeRecordInternal as unknown as { _handler: Function }
    )._handler(ctx, {
      skillId: "skills:1",
      kind: "highlighted",
      byUserId: "users:1",
      at: 123,
    });

    expect(result).toEqual({ inserted: true });
    expect(insert).toHaveBeenCalledWith("skillBadges", {
      skillId: "skills:1",
      kind: "highlighted",
      byUserId: "users:1",
      at: 123,
    });
    expect(patch).toHaveBeenCalledWith("skills:1", {
      badges: {
        highlighted: { byUserId: "users:1", at: 123 },
      },
    });
  });

  it("resyncs denormalized badge even when table record already exists", async () => {
    const unique = vi.fn().mockResolvedValue({ _id: "skillBadges:existing" });
    const query = vi.fn().mockReturnValue({
      withIndex: () => ({ unique }),
    });
    const insert = vi.fn();
    const get = vi.fn().mockResolvedValue({ _id: "skills:1", badges: {} });
    const patch = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      db: {
        query,
        insert,
        get,
        patch,
        normalizeId: vi.fn(),
      },
    } as never;

    const result = await (
      upsertSkillBadgeRecordInternal as unknown as { _handler: Function }
    )._handler(ctx, {
      skillId: "skills:1",
      kind: "official",
      byUserId: "users:2",
      at: 456,
    });

    expect(result).toEqual({ inserted: false });
    expect(insert).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith("skills:1", {
      badges: {
        official: { byUserId: "users:2", at: 456 },
      },
    });
  });
});

describe("maintenance capability tag backfill", () => {
  it("keeps latest skill search digest capability tags in sync", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1234);
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "skillVersions:1",
        capabilityTags: ["can-make-purchases"],
      })
      .mockResolvedValueOnce({
        _id: "skills:1",
        latestVersionId: "skillVersions:1",
        capabilityTags: ["can-make-purchases"],
      });
    const unique = vi.fn().mockResolvedValue({
      _id: "skillSearchDigest:1",
      capabilityTags: ["can-make-purchases"],
    });
    const withIndex = vi.fn((_indexName, callback) => {
      callback({ eq: vi.fn() });
      return { unique };
    });
    const query = vi.fn().mockReturnValue({ withIndex });
    const patch = vi.fn().mockResolvedValue(undefined);

    const result = await (
      applySkillCapabilityTagsInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          get,
          patch,
          query,
          normalizeId: vi.fn(),
        },
      } as never,
      {
        skillId: "skills:1",
        versionId: "skillVersions:1",
        capabilityTags: ["financial-authority", "can-make-purchases"],
      },
    );

    expect(result).toEqual({
      ok: true,
      versionPatched: true,
      skillPatched: true,
      digestPatched: true,
    });
    expect(patch).toHaveBeenNthCalledWith(1, "skillVersions:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
    });
    expect(patch).toHaveBeenNthCalledWith(2, "skills:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
      updatedAt: 1234,
    });
    expect(patch).toHaveBeenNthCalledWith(3, "skillSearchDigest:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
      updatedAt: 1234,
    });
    expect(query).toHaveBeenCalledWith("skillSearchDigest");
    expect(withIndex).toHaveBeenCalledWith("by_skill", expect.any(Function));

    nowSpy.mockRestore();
  });

  it("counts trigger-synced digest tags when the latest skill tags change", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2222);
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "skillVersions:1",
        capabilityTags: ["can-make-purchases"],
      })
      .mockResolvedValueOnce({
        _id: "skills:1",
        latestVersionId: "skillVersions:1",
        capabilityTags: ["can-make-purchases"],
      });
    const unique = vi.fn().mockResolvedValue({
      _id: "skillSearchDigest:1",
      capabilityTags: ["financial-authority", "can-make-purchases"],
    });
    const withIndex = vi.fn((_indexName, callback) => {
      callback({ eq: vi.fn() });
      return { unique };
    });
    const query = vi.fn().mockReturnValue({ withIndex });
    const patch = vi.fn().mockResolvedValue(undefined);

    const result = await (
      applySkillCapabilityTagsInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          get,
          patch,
          query,
          normalizeId: vi.fn(),
        },
      } as never,
      {
        skillId: "skills:1",
        versionId: "skillVersions:1",
        capabilityTags: ["financial-authority", "can-make-purchases"],
      },
    );

    expect(result).toEqual({
      ok: true,
      versionPatched: true,
      skillPatched: true,
      digestPatched: true,
    });
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenNthCalledWith(1, "skillVersions:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
    });
    expect(patch).toHaveBeenNthCalledWith(2, "skills:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
      updatedAt: 2222,
    });

    nowSpy.mockRestore();
  });

  it("repairs a stale latest skill search digest even when skill tags already match", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "skillVersions:1",
        capabilityTags: ["financial-authority", "can-make-purchases"],
      })
      .mockResolvedValueOnce({
        _id: "skills:1",
        latestVersionId: "skillVersions:1",
        capabilityTags: ["financial-authority", "can-make-purchases"],
        updatedAt: 987,
      });
    const unique = vi.fn().mockResolvedValue({
      _id: "skillSearchDigest:1",
      capabilityTags: ["can-make-purchases"],
    });
    const withIndex = vi.fn((_indexName, callback) => {
      callback({ eq: vi.fn() });
      return { unique };
    });
    const query = vi.fn().mockReturnValue({ withIndex });
    const patch = vi.fn().mockResolvedValue(undefined);

    const result = await (
      applySkillCapabilityTagsInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          get,
          patch,
          query,
          normalizeId: vi.fn(),
        },
      } as never,
      {
        skillId: "skills:1",
        versionId: "skillVersions:1",
        capabilityTags: ["financial-authority", "can-make-purchases"],
      },
    );

    expect(result).toEqual({
      ok: true,
      versionPatched: false,
      skillPatched: false,
      digestPatched: true,
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("skillSearchDigest:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
      updatedAt: 987,
    });
  });
});

describe("maintenance fingerprint backfill", () => {
  it("backfills fingerprint field and inserts index entry", async () => {
    const { hashSkillFiles } = await import("./lib/skills");
    const expected = await hashSkillFiles([{ path: "SKILL.md", sha256: "abc" }]);

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: "skills:1",
          versionId: "skillVersions:1",
          versionFingerprint: undefined,
          files: [{ path: "SKILL.md", sha256: "abc" }],
          existingEntries: [],
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.versionsScanned).toBe(1);
    expect(result.stats.versionsPatched).toBe(1);
    expect(result.stats.fingerprintsInserted).toBe(1);
    expect(result.stats.fingerprintMismatches).toBe(0);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      versionId: "skillVersions:1",
      fingerprint: expected,
      patchVersion: true,
      replaceEntries: true,
      existingEntryIds: [],
    });
  });

  it("dryRun does not patch", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: "skills:1",
          versionId: "skillVersions:1",
          versionFingerprint: undefined,
          files: [{ path: "SKILL.md", sha256: "abc" }],
          existingEntries: [],
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn();

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: true, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.versionsPatched).toBe(1);
    expect(result.stats.fingerprintsInserted).toBe(1);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("patches missing version fingerprint without touching correct entries", async () => {
    const { hashSkillFiles } = await import("./lib/skills");
    const expected = await hashSkillFiles([{ path: "SKILL.md", sha256: "abc" }]);

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: "skills:1",
          versionId: "skillVersions:1",
          versionFingerprint: undefined,
          files: [{ path: "SKILL.md", sha256: "abc" }],
          existingEntries: [{ id: "skillVersionFingerprints:1", fingerprint: expected }],
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.versionsPatched).toBe(1);
    expect(result.stats.fingerprintsInserted).toBe(0);
    expect(result.stats.fingerprintMismatches).toBe(0);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      versionId: "skillVersions:1",
      fingerprint: expected,
      patchVersion: true,
      replaceEntries: false,
      existingEntryIds: [],
    });
  });

  it("replaces mismatched fingerprint entries", async () => {
    const { hashSkillFiles } = await import("./lib/skills");
    const expected = await hashSkillFiles([{ path: "SKILL.md", sha256: "abc" }]);

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: "skills:1",
          versionId: "skillVersions:1",
          versionFingerprint: "wrong",
          files: [{ path: "SKILL.md", sha256: "abc" }],
          existingEntries: [{ id: "skillVersionFingerprints:1", fingerprint: "wrong" }],
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.fingerprintMismatches).toBe(1);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      versionId: "skillVersions:1",
      fingerprint: expected,
      patchVersion: true,
      replaceEntries: true,
      existingEntryIds: ["skillVersionFingerprints:1"],
    });
  });

  it("ignores generated Skill Cards and bundle fingerprints for source backfills", async () => {
    const { hashSkillFiles } = await import("./lib/skills");
    const sourceFingerprint = await hashSkillFiles([{ path: "SKILL.md", sha256: "abc" }]);
    const bundleFingerprint = await hashSkillFiles([
      { path: "SKILL.md", sha256: "abc" },
      { path: "skill-card.md", sha256: "def" },
    ]);

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: "skills:1",
          versionId: "skillVersions:1",
          versionFingerprint: sourceFingerprint,
          files: [
            { path: "SKILL.md", sha256: "abc" },
            { path: "skill-card.md", sha256: "def" },
          ],
          hasGeneratedBundleFingerprint: true,
          existingEntries: [
            {
              id: "skillVersionFingerprints:source",
              fingerprint: sourceFingerprint,
              kind: "source",
            },
            {
              id: "skillVersionFingerprints:bundle",
              fingerprint: bundleFingerprint,
              kind: "generated-bundle",
            },
          ],
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn();

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.versionsPatched).toBe(0);
    expect(result.stats.fingerprintsInserted).toBe(0);
    expect(result.stats.fingerprintMismatches).toBe(0);
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("maintenance empty skill cleanup", () => {
  it("dryRun detects empty skills and returns nominations", async () => {
    const runQuery = vi.fn().mockImplementation(async (endpoint: unknown) => {
      if (endpoint === internal.maintenance.getEmptySkillCleanupPageInternal) {
        return {
          items: [
            {
              skillId: "skills:1",
              slug: "spam-skill",
              ownerUserId: "users:1",
              latestVersionId: "skillVersions:1",
              softDeletedAt: undefined,
              summary: "Expert guidance for spam-skill.",
            },
          ],
          cursor: null,
          isDone: true,
        };
      }
      if (endpoint === internal.skills.getVersionByIdInternal) {
        return {
          _id: "skillVersions:1",
          files: [{ path: "SKILL.md", size: 120, storageId: "storage:1" }],
        };
      }
      if (endpoint === internal.users.getByIdInternal) {
        return { _id: "users:1", handle: "spammer", _creationTime: Date.now() };
      }
      if (endpoint === internal.skills.getOwnerSkillActivityInternal) {
        return [];
      }
      throw new Error(`Unexpected endpoint: ${String(endpoint)}`);
    });

    const runMutation = vi.fn();
    const storageGet = vi
      .fn()
      .mockResolvedValue(
        makeBlob(`# Demo\n- Step-by-step tutorials\n- Tips and techniques\n- Project ideas`),
      );

    const result = await cleanupEmptySkillsInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: true, batchSize: 10, maxBatches: 1, nominationThreshold: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.isDone).toBe(true);
    expect(result.cursor).toBeNull();
    expect(result.stats.emptyDetected).toBe(1);
    expect(result.stats.skillsDeleted).toBe(0);
    expect(result.nominations).toEqual([
      {
        userId: "users:1",
        handle: "spammer",
        emptySkillCount: 1,
        sampleSlugs: ["spam-skill"],
      },
    ]);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("apply mode deletes empty skills", async () => {
    const runQuery = vi.fn().mockImplementation(async (endpoint: unknown) => {
      if (endpoint === internal.maintenance.getEmptySkillCleanupPageInternal) {
        return {
          items: [
            {
              skillId: "skills:1",
              slug: "spam-a",
              ownerUserId: "users:1",
              latestVersionId: "skillVersions:1",
              summary: "Expert guidance for spam-a.",
            },
            {
              skillId: "skills:2",
              slug: "spam-b",
              ownerUserId: "users:1",
              latestVersionId: "skillVersions:2",
              summary: "Expert guidance for spam-b.",
            },
          ],
          cursor: null,
          isDone: true,
        };
      }
      if (endpoint === internal.skills.getVersionByIdInternal) {
        return {
          files: [{ path: "SKILL.md", size: 120, storageId: "storage:1" }],
        };
      }
      if (endpoint === internal.users.getByIdInternal) {
        return { _id: "users:1", handle: "spammer", _creationTime: Date.now() };
      }
      if (endpoint === internal.skills.getOwnerSkillActivityInternal) {
        return [];
      }
      throw new Error(`Unexpected endpoint: ${String(endpoint)}`);
    });

    const runMutation = vi.fn().mockImplementation(async (endpoint: unknown) => {
      if (endpoint === internal.maintenance.applyEmptySkillCleanupInternal) {
        return { deleted: true };
      }
      throw new Error(`Unexpected mutation endpoint: ${String(endpoint)}`);
    });

    const storageGet = vi
      .fn()
      .mockResolvedValue(
        makeBlob(`# Demo\n- Step-by-step tutorials\n- Tips and techniques\n- Project ideas`),
      );

    const result = await cleanupEmptySkillsInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1, nominationThreshold: 2 },
    );

    expect(result.ok).toBe(true);
    expect(result.isDone).toBe(true);
    expect(result.cursor).toBeNull();
    expect(result.stats.emptyDetected).toBe(2);
    expect(result.stats.skillsDeleted).toBe(2);
    expect(result.nominations).toEqual([
      {
        userId: "users:1",
        handle: "spammer",
        emptySkillCount: 2,
        sampleSlugs: ["spam-a", "spam-b"],
      },
    ]);
  });
});

describe("maintenance empty skill nominations", () => {
  it("creates ban nominations from backfilled empty deletions", async () => {
    const runQuery = vi.fn().mockImplementation(async (endpoint: unknown, args: unknown) => {
      if (endpoint === internal.maintenance.getEmptySkillCleanupPageInternal) {
        const cursor = (args as { cursor?: string | undefined }).cursor;
        if (!cursor) {
          return {
            items: [
              {
                skillId: "skills:1",
                slug: "spam-a",
                ownerUserId: "users:1",
                softDeletedAt: 1,
                moderationReason: "quality.empty.backfill",
              },
              {
                skillId: "skills:2",
                slug: "spam-b",
                ownerUserId: "users:1",
                softDeletedAt: 1,
                moderationReason: "quality.empty.backfill",
              },
            ],
            cursor: "next",
            isDone: false,
          };
        }
        return {
          items: [
            {
              skillId: "skills:3",
              slug: "valid-hidden",
              ownerUserId: "users:2",
              softDeletedAt: 1,
              moderationReason: "scanner.vt.suspicious",
            },
          ],
          cursor: null,
          isDone: true,
        };
      }
      if (endpoint === internal.users.getByIdInternal) {
        return { _id: "users:1", handle: "spammer" };
      }
      throw new Error(`Unexpected query endpoint: ${String(endpoint)}`);
    });

    const runMutation = vi.fn().mockImplementation(async (endpoint: unknown) => {
      if (endpoint === internal.maintenance.nominateUserForEmptySkillSpamInternal) {
        return { created: true };
      }
      throw new Error(`Unexpected mutation endpoint: ${String(endpoint)}`);
    });

    const result = await nominateEmptySkillSpammersInternalHandler(
      { runQuery, runMutation } as never,
      { batchSize: 10, maxBatches: 2, nominationThreshold: 2 },
    );

    expect(result.ok).toBe(true);
    expect(result.isDone).toBe(true);
    expect(result.stats.usersFlagged).toBe(1);
    expect(result.stats.nominationsCreated).toBe(1);
    expect(result.stats.nominationsExisting).toBe(0);
    expect(result.nominations).toEqual([
      {
        userId: "users:1",
        handle: "spammer",
        emptySkillCount: 2,
        sampleSlugs: ["spam-a", "spam-b"],
      },
    ]);
  });
});
