import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/access", async () => {
  const actual = await vi.importActual<typeof import("./lib/access")>("./lib/access");
  return {
    ...actual,
    requireUser: vi.fn(),
  };
});

const { requireUser } = await import("./lib/access");
const { setSkillManualOverride, clearSkillManualOverride, updateVersionLlmAnalysisInternal } =
  await import("./skills");

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const setSkillManualOverrideHandler = (
  setSkillManualOverride as unknown as WrappedHandler<{
    skillId: string;
    note: string;
  }>
)._handler;

const clearSkillManualOverrideHandler = (
  clearSkillManualOverride as unknown as WrappedHandler<{
    skillId: string;
    note: string;
  }>
)._handler;

const updateVersionLlmAnalysisInternalHandler = (
  updateVersionLlmAnalysisInternal as unknown as WrappedHandler<{
    versionId: string;
    llmAnalysis: Record<string, unknown>;
  }>
)._handler;

function makeCtx(params: { skill: Record<string, unknown>; version?: Record<string, unknown> }) {
  const patch = vi.fn(async () => {});
  const insert = vi.fn(async () => "auditLogs:1");
  const query = vi.fn((table: string) => {
    if (table === "globalStats") {
      return {
        withIndex: vi.fn(() => ({
          unique: vi.fn(async () => ({ _id: "globalStats:1", activeSkillsCount: 1 })),
        })),
      };
    }

    if (table === "skills") {
      return {
        withIndex: vi.fn(() => ({
          collect: vi.fn(async () => [params.skill]),
        })),
      };
    }

    throw new Error(`Unexpected query table: ${table}`);
  });
  const get = vi.fn(async (id: string) => {
    if (id === params.skill._id) return params.skill;
    if (params.version && id === params.version._id) return params.version;
    if (params.version && id === params.skill.latestVersionId) return params.version;
    return null;
  });

  return {
    ctx: {
      db: { get, patch, insert, query, normalizeId: vi.fn() },
    } as never,
    patch,
    insert,
    get,
    query,
  };
}

describe("skills manual overrides", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(requireUser).mockReset();
  });

  it("applies a skill-level override and preserves scan metadata", async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);

    const skill = {
      _id: "skills:1",
      latestVersionId: "skillVersions:1",
      softDeletedAt: undefined,
      moderationStatus: "active",
      moderationReason: "scanner.vt.suspicious",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
      moderationReasonCodes: ["suspicious.vt_suspicious"],
      moderationEvidence: [
        { code: "x", severity: "warn", file: "SKILL.md", line: 1, message: "x", evidence: "x" },
      ],
      moderationEngineVersion: "v2.0.0",
      moderationSourceVersionId: "skillVersions:1",
    };

    const { ctx, patch, insert } = makeCtx({ skill });

    await setSkillManualOverrideHandler(ctx, {
      skillId: "skills:1",
      note: "reviewed locally",
    });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        manualOverride: expect.objectContaining({
          verdict: "clean",
          note: "reviewed locally",
          reviewerUserId: "users:moderator",
          updatedAt: now,
        }),
        moderationReason: "manual.override.clean",
        moderationVerdict: "clean",
        moderationFlags: undefined,
        moderationReasonCodes: ["suspicious.vt_suspicious"],
        moderationEngineVersion: "v2.0.0",
        isSuspicious: false,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "skill.manual_override.set",
        targetType: "skill",
        targetId: "skills:1",
      }),
    );
  });

  it("increments global public count when an override restores a hidden skill", async () => {
    const now = 1_700_000_050_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);

    const skill = {
      _id: "skills:1",
      latestVersionId: "skillVersions:1",
      softDeletedAt: undefined,
      moderationStatus: "hidden",
      moderationReason: "scanner.vt.suspicious",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
      moderationReasonCodes: ["suspicious.vt_suspicious"],
      moderationSourceVersionId: "skillVersions:1",
    };

    const { ctx, patch } = makeCtx({ skill });

    await setSkillManualOverrideHandler(ctx, {
      skillId: "skills:1",
      note: "reviewed and okay to list",
    });

    expect(patch).toHaveBeenCalledWith(
      "globalStats:1",
      expect.objectContaining({
        activeSkillsCount: 2,
        updatedAt: now,
      }),
    );
  });

  it("clears a skill-level override and restores scanner-derived suspicious state", async () => {
    const now = 1_700_000_100_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);

    const skill = {
      _id: "skills:1",
      latestVersionId: "skillVersions:3",
      moderationReason: "manual.override.clean",
      moderationVerdict: "clean",
      moderationFlags: undefined,
      manualOverride: {
        verdict: "clean",
        note: "reviewed locally",
        reviewerUserId: "users:moderator",
        updatedAt: now - 10_000,
      },
    };
    const version = {
      _id: "skillVersions:3",
      skillId: "skills:1",
      staticScan: undefined,
      vtAnalysis: { status: "suspicious", checkedAt: now - 1000 },
      llmAnalysis: undefined,
    };

    const { ctx, patch, insert } = makeCtx({ skill, version });

    await clearSkillManualOverrideHandler(ctx, {
      skillId: "skills:1",
      note: "scanner is fixed now",
    });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        manualOverride: undefined,
        updatedAt: now,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationReason: "scanner.vt.suspicious",
        moderationVerdict: "suspicious",
        moderationFlags: ["flagged.suspicious"],
        isSuspicious: true,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "skill.manual_override.clear",
        targetType: "skill",
        targetId: "skills:1",
      }),
    );
  });

  it("clears a skill-level override and restores hidden malicious state", async () => {
    const now = 1_700_000_200_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);

    const skill = {
      _id: "skills:1",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:4",
      moderationStatus: "active",
      moderationReason: "manual.override.clean",
      moderationVerdict: "clean",
      moderationFlags: undefined,
      manualOverride: {
        verdict: "clean",
        note: "reviewed locally",
        reviewerUserId: "users:moderator",
        updatedAt: now - 10_000,
      },
    };
    const version = {
      _id: "skillVersions:4",
      skillId: "skills:1",
      staticScan: undefined,
      vtAnalysis: { status: "malicious", checkedAt: now - 1000 },
      llmAnalysis: undefined,
    };

    const { ctx, patch } = makeCtx({ skill, version });

    await clearSkillManualOverrideHandler(ctx, {
      skillId: "skills:1",
      note: "restoring scanner verdict",
    });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "hidden",
        moderationReason: "scanner.vt.malicious",
        moderationVerdict: "malicious",
        moderationFlags: ["blocked.malware"],
        hiddenAt: now,
        lastReviewedAt: now,
        isSuspicious: false,
      }),
    );
  });

  it("rejects override notes longer than the max length", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);

    const skill = {
      _id: "skills:1",
      latestVersionId: "skillVersions:1",
      softDeletedAt: undefined,
      moderationStatus: "active",
      moderationReason: "scanner.vt.suspicious",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
    };

    const { ctx, patch, insert } = makeCtx({ skill });

    await expect(
      setSkillManualOverrideHandler(ctx, {
        skillId: "skills:1",
        note: "x".repeat(1201),
      }),
    ).rejects.toThrow("Audit note must be at most 1200 characters.");
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects manual overrides for malware-blocked skills", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);

    const skill = {
      _id: "skills:1",
      latestVersionId: "skillVersions:1",
      softDeletedAt: undefined,
      moderationStatus: "hidden",
      moderationReason: "manual.override.clean",
      moderationVerdict: "malicious",
      moderationFlags: ["blocked.malware"],
    };

    const { ctx, patch, insert } = makeCtx({ skill });

    await expect(
      setSkillManualOverrideHandler(ctx, {
        skillId: "skills:1",
        note: "trying to reactivate blocked malware",
      }),
    ).rejects.toThrow("Skill is not currently suspicious.");
    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not let llm scan sync clear an existing quality quarantine", async () => {
    vi.mocked(requireUser).mockReset();

    const skill = {
      _id: "skills:1",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:7",
      moderationStatus: "hidden",
      moderationReason: "quality.low",
      moderationVerdict: "clean",
      moderationFlags: undefined,
    };
    const version = {
      _id: "skillVersions:7",
      skillId: "skills:1",
      staticScan: undefined,
      vtAnalysis: { status: "clean", checkedAt: 100 },
      llmAnalysis: undefined,
    };

    const { ctx, patch } = makeCtx({ skill, version });

    await updateVersionLlmAnalysisInternalHandler(ctx, {
      versionId: "skillVersions:7",
      llmAnalysis: {
        status: "clean",
        checkedAt: 200,
      },
    });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("skillVersions:7", {
      llmAnalysis: {
        status: "clean",
        checkedAt: 200,
      },
    });
  });

  it("updates global public count when llm scan sync restores a skill to active", async () => {
    const now = 1_700_000_300_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const skill = {
      _id: "skills:1",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:8",
      softDeletedAt: undefined,
      moderationStatus: "hidden",
      moderationReason: "scanner.llm.suspicious",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
    };
    const version = {
      _id: "skillVersions:8",
      skillId: "skills:1",
      staticScan: undefined,
      vtAnalysis: undefined,
      llmAnalysis: { status: "suspicious", checkedAt: now - 100 },
    };

    const { ctx, patch } = makeCtx({ skill, version });

    await updateVersionLlmAnalysisInternalHandler(ctx, {
      versionId: "skillVersions:8",
      llmAnalysis: {
        status: "clean",
        checkedAt: now,
      },
    });

    expect(patch).toHaveBeenCalledWith(
      "globalStats:1",
      expect.objectContaining({
        activeSkillsCount: 2,
        updatedAt: now,
      }),
    );
  });
});
