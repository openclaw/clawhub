import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/access", async () => {
  const actual = await vi.importActual<typeof import("./lib/access")>("./lib/access");
  return {
    ...actual,
    requireUser: vi.fn(),
  };
});

const { requireUser } = await import("./lib/access");
const {
  setSkillManualOverride,
  clearSkillManualOverride,
  resolveSkillAppealForUserInternal,
  updateSkillVersionStaticScanInternal,
  updateVersionScanResultsInternal,
  updateVersionLlmAnalysisInternal,
} = await import("./skills");

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

const resolveSkillAppealForUserInternalHandler = (
  resolveSkillAppealForUserInternal as unknown as WrappedHandler<{
    actorUserId: string;
    appealId: string;
    status: "open" | "accepted" | "rejected";
    note?: string;
    finalAction?: "none" | "restore";
  }>
)._handler;

const updateVersionLlmAnalysisInternalHandler = (
  updateVersionLlmAnalysisInternal as unknown as WrappedHandler<{
    versionId: string;
    moderationMode?: "normal" | "preserve";
    llmAnalysis: Record<string, unknown>;
  }>
)._handler;

const updateVersionScanResultsInternalHandler = (
  updateVersionScanResultsInternal as unknown as WrappedHandler<{
    versionId: string;
    sha256hash?: string;
    vtAnalysis?: Record<string, unknown>;
  }>
)._handler;

const updateSkillVersionStaticScanInternalHandler = (
  updateSkillVersionStaticScanInternal as unknown as WrappedHandler<{
    skillId: string;
    versionId: string;
    staticScan: {
      status: "clean" | "suspicious" | "malicious";
      reasonCodes: string[];
      findings: Array<{
        code: string;
        severity: "info" | "warn" | "critical";
        file: string;
        line: number;
        message: string;
        evidence: string;
      }>;
      summary: string;
      engineVersion: string;
      checkedAt: number;
    };
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

    if (table === "rescanRequests") {
      return {
        withIndex: vi.fn(() => ({
          order: vi.fn(() => ({
            take: vi.fn(async () => []),
          })),
        })),
      };
    }

    if (table === "skillReports" || table === "skillAppeals") {
      return {
        withIndex: vi.fn(() => ({
          collect: vi.fn(async () => []),
        })),
      };
    }
    if (table === "skillEmbeddings") {
      return {
        withIndex: vi.fn(() => ({
          collect: vi.fn(async () => []),
        })),
      };
    }

    throw new Error(`Unexpected query table: ${table}`);
  });
  const get = vi.fn(async (id: string) => {
    if (id === params.skill._id) return params.skill;
    if (params.version && id === params.version._id) return params.version;
    if (params.version && id === params.skill.latestVersionId) return params.version;
    if (id === params.skill.latestVersionId) {
      return {
        _id: id,
        skillId: params.skill._id,
        version: "1.0.0",
        staticScan: {
          status: params.skill.moderationVerdict ?? "suspicious",
          reasonCodes: params.skill.moderationReasonCodes ?? ["suspicious.test"],
          findings: [],
          summary: "Scanner summary",
          engineVersion: "test",
          checkedAt: 1,
        },
        vtAnalysis: { status: params.skill.moderationVerdict ?? "suspicious", checkedAt: 1 },
        createdAt: 1,
      };
    }
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

function makeStatefulModerationLifecycleCtx(params: {
  skill: Record<string, unknown>;
  versions: Record<string, Record<string, unknown>>;
}) {
  const docs: Record<string, Record<string, unknown>> = {
    [params.skill._id as string]: { ...params.skill },
    ...Object.fromEntries(
      Object.entries(params.versions).map(([id, version]) => [id, { ...version }]),
    ),
  };
  const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
    docs[id] = { ...docs[id], ...value };
  });
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
          collect: vi.fn(async () => [docs[params.skill._id as string]]),
        })),
      };
    }
    if (table === "skillReports" || table === "skillAppeals") {
      return {
        withIndex: vi.fn(() => ({
          collect: vi.fn(async () => []),
        })),
      };
    }
    if (table === "skillEmbeddings") {
      return {
        withIndex: vi.fn(() => ({
          collect: vi.fn(async () => []),
        })),
      };
    }
    if (table === "rescanRequests") {
      return {
        withIndex: vi.fn(() => ({
          order: vi.fn(() => ({
            take: vi.fn(async () => []),
          })),
        })),
      };
    }
    throw new Error(`Unexpected query table: ${table}`);
  });
  const get = vi.fn(async (id: string) => {
    if (id === "users:moderator") return { _id: id, role: "moderator" };
    if (id === "users:owner") return { _id: id, role: "user" };
    return docs[id] ?? null;
  });
  const scheduler = { runAfter: vi.fn(async () => {}) };

  return {
    ctx: {
      db: { get, patch, insert, query, normalizeId: vi.fn() },
      scheduler,
    } as never,
    docs,
    patch,
    scheduler,
  };
}

function staticScan(status: "clean" | "suspicious" | "malicious", checkedAt: number) {
  return {
    status,
    reasonCodes: status === "clean" ? [] : [`${status}.test`],
    findings:
      status === "clean"
        ? []
        : [
            {
              code: `${status}.test`,
              severity: status === "malicious" ? ("critical" as const) : ("warn" as const),
              file: "SKILL.md",
              line: 1,
              message: `${status} finding`,
              evidence: "test evidence",
            },
          ],
    summary: `${status} summary`,
    engineVersion: "test",
    checkedAt,
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
    expect(patch).not.toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        manualOverride: undefined,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "skill.manual_override.set",
        targetType: "skill",
        targetId: "skills:1",
        metadata: expect.objectContaining({
          verdict: "clean",
          note: "reviewed locally",
          previousVerdict: "suspicious",
          versionId: "skillVersions:1",
        }),
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

  it("can store llm backfill results without syncing moderation", async () => {
    const now = 1_700_000_250_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const skill = {
      _id: "skills:1",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:7",
      softDeletedAt: undefined,
      moderationStatus: "active",
      moderationReason: undefined,
      moderationVerdict: undefined,
      moderationFlags: undefined,
    };
    const version = {
      _id: "skillVersions:7",
      skillId: "skills:1",
      staticScan: undefined,
      vtAnalysis: undefined,
      llmAnalysis: undefined,
    };

    const { ctx, patch, get, query } = makeCtx({ skill, version });

    await updateVersionLlmAnalysisInternalHandler(ctx, {
      versionId: "skillVersions:7",
      moderationMode: "preserve",
      llmAnalysis: {
        status: "malicious",
        verdict: "malicious",
        checkedAt: now,
      },
    });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("skillVersions:7", {
      llmAnalysis: {
        status: "malicious",
        verdict: "malicious",
        checkedAt: now,
      },
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("skillVersions:7");
    expect(get).not.toHaveBeenCalledWith("skills:1");
    expect(query).not.toHaveBeenCalled();
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

  it("clears legacy suspicious state when LLM corroborates clean VT Code Insight-only suspicious", async () => {
    const now = 1_700_000_400_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const skill = {
      _id: "skills:1",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:9",
      softDeletedAt: undefined,
      moderationStatus: "hidden",
      moderationReason: "scanner.vt.suspicious",
      moderationVerdict: "suspicious",
      moderationFlags: ["flagged.suspicious"],
    };
    const version = {
      _id: "skillVersions:9",
      skillId: "skills:1",
      staticScan: {
        status: "clean",
        reasonCodes: [],
        findings: [],
        summary: "",
        engineVersion: "v2.1.1",
        checkedAt: now - 200,
      },
      vtAnalysis: {
        status: "suspicious",
        scanner: "code_insight",
        engineStats: {
          malicious: 0,
          suspicious: 0,
          harmless: 12,
          undetected: 54,
        },
        checkedAt: now - 100,
      },
      llmAnalysis: undefined,
    };

    const { ctx, patch } = makeCtx({ skill, version });

    await updateVersionLlmAnalysisInternalHandler(ctx, {
      versionId: "skillVersions:9",
      llmAnalysis: {
        status: "clean",
        checkedAt: now,
      },
    });

    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "active",
        moderationReason: "scanner.aggregate.clean",
        moderationFlags: undefined,
        moderationVerdict: "clean",
        moderationReasonCodes: undefined,
        isSuspicious: false,
      }),
    );
  });

  it("keeps skill-level moderator approval across rescans and new versions", async () => {
    const now = 1_700_000_500_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);

    const skill = {
      _id: "skills:1",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:1",
      softDeletedAt: undefined,
      moderationStatus: "hidden",
      moderationReason: "scanner.static.malicious",
      moderationVerdict: "malicious",
      moderationFlags: ["malware.detected"],
      moderationReasonCodes: ["malicious.test"],
      moderationSourceVersionId: "skillVersions:1",
      tags: {},
      stats: { downloads: 0, installsCurrent: 0, installsAllTime: 0, stars: 0, versions: 1 },
    };
    const versionOne = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      version: "1.0.0",
      staticScan: staticScan("malicious", now - 100),
      createdAt: now - 100,
    };
    const versionTwo = {
      _id: "skillVersions:2",
      skillId: "skills:1",
      version: "2.0.0",
      staticScan: staticScan("clean", now - 50),
      createdAt: now - 50,
    };
    const { ctx, docs, patch, scheduler } = makeStatefulModerationLifecycleCtx({
      skill,
      versions: {
        "skillVersions:1": versionOne,
        "skillVersions:2": versionTwo,
      },
    });

    docs["skillAppeals:1"] = {
      _id: "skillAppeals:1",
      skillId: "skills:1",
      skillVersionId: "skillVersions:1",
      version: "1.0.0",
      userId: "users:owner",
      message: "false positive",
      status: "open",
      createdAt: now - 10,
    };

    await resolveSkillAppealForUserInternalHandler(ctx, {
      actorUserId: "users:moderator",
      appealId: "skillAppeals:1",
      status: "accepted",
      note: "false positive on version one",
      finalAction: "restore",
    });

    expect(docs["skills:1"]).toMatchObject({
      manualOverride: expect.objectContaining({
        verdict: "clean",
        note: "false positive on version one",
        reviewerUserId: "users:moderator",
        updatedAt: now,
      }),
      moderationStatus: "active",
      moderationReason: "manual.override.clean",
      moderationVerdict: "clean",
      moderationSourceVersionId: "skillVersions:1",
    });

    await updateSkillVersionStaticScanInternalHandler(ctx, {
      skillId: "skills:1",
      versionId: "skillVersions:1",
      staticScan: staticScan("malicious", now + 1),
    });

    expect(docs["skills:1"]).toMatchObject({
      moderationStatus: "active",
      moderationReason: "manual.override.clean",
      moderationVerdict: "clean",
      moderationSourceVersionId: "skillVersions:1",
    });
    expect(scheduler.runAfter).not.toHaveBeenCalled();

    docs["skills:1"] = { ...docs["skills:1"], latestVersionId: "skillVersions:2" };

    await updateSkillVersionStaticScanInternalHandler(ctx, {
      skillId: "skills:1",
      versionId: "skillVersions:2",
      staticScan: staticScan("malicious", now + 2),
    });

    expect(docs["skills:1"]).toMatchObject({
      moderationStatus: "active",
      moderationReason: "manual.override.clean",
      moderationVerdict: "clean",
      moderationSourceVersionId: "skillVersions:2",
    });
    expect(scheduler.runAfter).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationStatus: "active",
        moderationVerdict: "clean",
        moderationReason: "manual.override.clean",
      }),
    );
  });

  it("does not resync skill moderation from VT bookkeeping writes before a final verdict", async () => {
    const now = 1_700_000_600_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    const skill = {
      _id: "skills:1",
      ownerUserId: "users:owner",
      latestVersionId: "skillVersions:1",
      moderationStatus: "hidden",
      moderationReason: "pending.scan",
      moderationVerdict: "clean",
      tags: {},
      stats: { downloads: 0, installsCurrent: 0, installsAllTime: 0, stars: 0, versions: 1 },
    };
    const version = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      version: "1.0.0",
      staticScan: staticScan("clean", now - 100),
      createdAt: now - 100,
    };
    const { ctx, patch } = makeCtx({ skill, version });

    await updateVersionScanResultsInternalHandler(ctx, {
      versionId: "skillVersions:1",
      sha256hash: "abc123",
    });

    expect(patch).toHaveBeenCalledWith("skillVersions:1", { sha256hash: "abc123" });
    expect(patch).not.toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationReason: "scanner.aggregate.clean",
      }),
    );

    await updateVersionScanResultsInternalHandler(ctx, {
      versionId: "skillVersions:1",
      vtAnalysis: { status: "stale", checkedAt: now },
    });

    expect(patch).toHaveBeenCalledWith("skillVersions:1", {
      vtAnalysis: { status: "stale", checkedAt: now },
    });
    expect(patch).not.toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        moderationReason: "scanner.aggregate.clean",
      }),
    );
  });
});
