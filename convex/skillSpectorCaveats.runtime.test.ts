/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { capSkillSpectorInspectionCaveats } from "./lib/skillSpectorEvidence";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

it.each([false, true])(
  "keeps caveats and disagreement through scan completion (worker already capped: %s)",
  async (workerCapped) => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "caveat-worker-fixture");
    const t = convexTest(schema, modules);
    const { versionId, jobId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { handle: "caveat-fixture" });
      const publisherId = await ctx.db.insert("publishers", {
        kind: "user",
        handle: "caveat-fixture",
        displayName: "Caveat fixture",
        linkedUserId: userId,
        createdAt: 1,
        updatedAt: 1,
      });
      const skillId = await ctx.db.insert("skills", {
        slug: "caveat-fixture",
        displayName: "Caveat fixture",
        ownerUserId: userId,
        ownerPublisherId: publisherId,
        tags: {},
        badges: {},
        moderationStatus: "active",
        stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      const createdVersionId = await ctx.db.insert("skillVersions", {
        skillId,
        version: "1.0.0",
        changelog: "Fixture",
        files: [],
        parsed: { frontmatter: {} },
        createdBy: userId,
        createdAt: 1,
      });
      await ctx.db.patch(skillId, { latestVersionId: createdVersionId });
      const createdJobId = await ctx.db.insert("securityScanJobs", {
        targetKind: "skillVersion",
        skillVersionId: createdVersionId,
        status: "running",
        source: "manual",
        priority: 1,
        hasMaliciousSignal: false,
        waitForVtUntil: 0,
        nextRunAt: 0,
        attempts: 1,
        leaseToken: "caveat-lease",
        workerId: "caveat-worker",
        leaseExpiresAt: Date.now() + 60_000,
        createdAt: 1,
        updatedAt: 1,
      });
      return { versionId: createdVersionId, jobId: createdJobId };
    });
    const checkedAt = 123;
    const raw = JSON.stringify({
      checkedAt,
      aig: null,
      skillspector: {
        analysis_completeness: { status: "complete_with_caveats", is_complete: true },
        issues: [
          {
            id: "RA2",
            severity: "MEDIUM",
            confidence: 0.7,
            tags: ["llm-unconfirmed"],
            evidence: { llm_review_outcome: "disagreed", llm_review_confidence: 0.99 },
          },
        ],
        unabridged: "retained original evidence ".repeat(60_000),
      },
    });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([raw])));
    const inspectionCaveats = {
      status: "complete_with_caveats" as const,
      referenceCount: 15,
      exceptionCount: 15,
      references: Array.from({ length: 15 }, () => ({
        sourcePath: "SKILL.md",
        evidence: "agent.id ".repeat(500),
        status: "missing",
      })),
      ledgerExceptions: Array.from({ length: 15 }, () => ({
        reasonCode: "reference_missing",
        path: "SKILL.md",
        message: "A missing reference. ".repeat(500),
      })),
    };
    await t.action(api.securityScan.completeCodexScanJob, {
      token: "caveat-worker-fixture",
      jobId,
      leaseToken: "caveat-lease",
      llmAnalysis: { status: "clean", verdict: "benign", checkedAt },
      aigAnalysis: { status: "clean", issueCount: 0, findings: [], checkedAt },
      skillSpectorAnalysis: {
        status: "suspicious",
        inspectionStatus: "completed",
        issueCount: 1,
        checkedAt,
        inspectionCaveats: workerCapped
          ? capSkillSpectorInspectionCaveats(inspectionCaveats)
          : inspectionCaveats,
        issues: [
          {
            issueId: "RA2",
            severity: "MEDIUM",
            confidence: 0.7,
            explanation: "Retained deterministic finding.",
            tags: ["llm-unconfirmed", ...Array.from({ length: 12 }, () => "tag".repeat(100))],
            reviewOutcome: "disagreed",
            reviewConfidence: 0.99,
          },
        ],
      },
      scannerReportsStorageId: storageId,
    });
    const stored = await t.run((ctx) => ctx.db.get(versionId));
    expect(stored?.skillSpectorAnalysis).toMatchObject({
      status: "suspicious",
      inspectionStatus: "completed",
      issueCount: 1,
      inspectionCaveats: {
        status: "complete_with_caveats",
        referenceCount: 15,
        exceptionCount: 15,
      },
      issues: [
        {
          issueId: "RA2",
          severity: "MEDIUM",
          confidence: 0.7,
          reviewOutcome: "disagreed",
          reviewConfidence: 0.99,
        },
      ],
    });
    expect(stored?.skillSpectorAnalysis?.inspectionCaveats?.references).toHaveLength(10);
    expect(stored?.skillSpectorAnalysis?.inspectionCaveats?.ledgerExceptions).toHaveLength(10);
    expect(stored?.skillSpectorAnalysis?.inspectionCaveats).toEqual(
      capSkillSpectorInspectionCaveats(inspectionCaveats),
    );
    expect(
      stored?.skillSpectorAnalysis?.inspectionCaveats?.references[0].evidence?.length,
    ).toBeLessThan(550);
    expect(stored?.skillSpectorAnalysis?.issues[0].tags).toHaveLength(8);
    expect(stored?.skillSpectorAnalysis?.issues[0].tags?.[0]).toBe("llm-unconfirmed");
    const retained = await t.run(async (ctx) => (await ctx.storage.get(storageId))?.text());
    expect(retained).toBe(raw);
  },
);
