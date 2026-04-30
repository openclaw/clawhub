/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { CorpusRow } from "./build-skilltester-clawhub-corpus";
import {
  buildSkillEvalContextFromRow,
  findUnsupportedRuntimeClaims,
  normalizeReferenceVerdict,
  runComparison,
  selectCorpusRowsBySkillTesterRisk,
  selectCorpusRowsByTargets,
  type PromptRunRequest,
  type PromptRunResult,
} from "./run-clawscan-skilltester-eval";

function makeRow(params: {
  slug: string;
  contentStatus?: "fetched" | "missing";
  securityLevel?: string | null;
  securityScore?: number | null;
  skillMdContent?: string;
}): CorpusRow {
  const content =
    params.skillMdContent ??
    `---
name: ${params.slug}
description: Demo skill
metadata:
  clawdis:
    requires:
      env:
        - DEMO_TOKEN
---
# ${params.slug}

Use DEMO_TOKEN to call the demo API.`;

  return {
    schema_version: "1.0",
    corpus: "skilltester-clawhub",
    source: "SkillTester",
    content_status: params.contentStatus ?? "fetched",
    resolved: {
      owner: "acme",
      slug: params.slug,
      version: "1.0.0",
      canonical_url: `https://clawhub.ai/acme/${params.slug}`,
    },
    artifact:
      params.contentStatus === "missing"
        ? {
            source_repo: "https://github.com/openclaw/skills",
            repo_head: "abc123",
            content_source: "github_git_history",
            missing_reason: "fixture missing content",
          }
        : {
            source_repo: "https://github.com/openclaw/skills",
            repo_head: "abc123",
            content_source: "github_git_history",
            commit: "abc123",
            path: `skills/acme/${params.slug}/SKILL.md`,
            skill_md_sha256: "sha256",
            skill_md_bytes: Buffer.byteLength(content, "utf8"),
            skill_md_content: content,
          },
    skilltester: {
      summary: {
        source: "ClawHub",
        skill_name: `${params.slug}-1.0.0`,
        description: "Demo skill",
        security_level: params.securityLevel ?? undefined,
        security_score: params.securityScore ?? undefined,
      },
      detail_skill: {
        skill_url: `https://clawhub.ai/acme/${params.slug}`,
      },
      scores: {
        security: params.securityScore ?? undefined,
        security_level: params.securityLevel ?? undefined,
      },
      security: {
        level: params.securityLevel ?? undefined,
        score: params.securityScore ?? undefined,
      },
      source_urls: {
        detail_api_url: `https://skilltester.ai/api/skills/${params.slug}-1.0.0`,
        skill_url: `https://clawhub.ai/acme/${params.slug}`,
      },
      timestamps: {
        summary_updated_at: "2026-01-01T00:00:00Z",
      },
    },
    reference_labels: {
      source: "SkillTester",
      caveat: "Fixture labels are not absolute truth.",
      security_level: params.securityLevel ?? undefined,
      security_score: params.securityScore ?? undefined,
    },
  };
}

function legacyResponse(verdict: "benign" | "suspicious" | "malicious") {
  return JSON.stringify({
    verdict,
    confidence: "medium",
    summary: `Legacy says ${verdict}.`,
    dimensions: {
      purpose_capability: { status: verdict === "benign" ? "ok" : "concern", detail: "Fixture." },
    },
    user_guidance: "Fixture guidance.",
  });
}

function asiResponse(verdict: "benign" | "suspicious" | "malicious") {
  const risky = verdict !== "benign";
  return JSON.stringify({
    verdict,
    confidence: "medium",
    summary: `ASI says ${verdict}.`,
    dimensions: {
      purpose_capability: { status: verdict === "benign" ? "ok" : "concern", detail: "Fixture." },
    },
    agentic_risk_findings: [
      {
        category_id: "ASI05",
        category_label: "Unexpected Code Execution",
        risk_bucket: "abnormal_behavior_control",
        status: risky ? "concern" : "none",
        severity: risky ? "medium" : "none",
        confidence: "medium",
        evidence: risky
          ? {
              path: "SKILL.md",
              snippet: "Use DEMO_TOKEN",
              explanation: "Fixture evidence for the eval harness.",
            }
          : undefined,
        user_impact: risky ? "Fixture concern." : "No concern.",
        recommendation: risky ? "Review the evidence." : "No action.",
      },
    ],
    risk_summary: {
      abnormal_behavior_control: {
        status: risky ? "concern" : "none",
        highest_severity: risky ? "medium" : "none",
        summary: risky ? "Fixture concern." : "No concern.",
      },
      permission_boundary: {
        status: "none",
        highest_severity: "none",
        summary: "No concern.",
      },
      sensitive_data_protection: {
        status: "none",
        highest_severity: "none",
        summary: "No concern.",
      },
    },
    user_guidance: "Fixture guidance.",
  });
}

function cliFalsePositiveResponse() {
  return JSON.stringify({
    verdict: "suspicious",
    confidence: "medium",
    summary: "A benign CLI helper was treated as suspicious because it installs a global npm CLI.",
    dimensions: {
      install_runtime: {
        status: "concern",
        detail: "Install: `npm install -g demo-cli`",
      },
    },
    agentic_risk_findings: [
      {
        category_id: "ASI04",
        category_label: "Agentic Dependency and Integration Trust",
        risk_bucket: "permission_boundary",
        status: "concern",
        severity: "medium",
        confidence: "medium",
        evidence: {
          path: "SKILL.md",
          snippet: "Install: `npm install -g demo-cli`",
          explanation: "Fixture evidence for CLI install false-positive clustering.",
        },
        user_impact: "Users may be warned about an expected CLI dependency.",
        recommendation: "Treat purpose-aligned CLI installs as notes when disclosed.",
      },
    ],
    risk_summary: {
      abnormal_behavior_control: {
        status: "none",
        highest_severity: "none",
        summary: "No concern.",
      },
      permission_boundary: {
        status: "concern",
        highest_severity: "medium",
        summary: "CLI install concern.",
      },
      sensitive_data_protection: {
        status: "none",
        highest_severity: "none",
        summary: "No concern.",
      },
    },
    user_guidance: "Fixture guidance.",
  });
}

describe("ClawScan SkillTester eval harness", () => {
  it("normalizes SkillTester reference labels and scores", () => {
    expect(
      normalizeReferenceVerdict(makeRow({ slug: "safe", securityLevel: "High" })),
    ).toMatchObject({
      verdict: "benign",
      basis: "level",
    });
    expect(
      normalizeReferenceVerdict(makeRow({ slug: "review", securityLevel: "Needs review" })),
    ).toMatchObject({
      verdict: "suspicious",
      basis: "level",
    });
    expect(normalizeReferenceVerdict(makeRow({ slug: "bad", securityScore: 35 }))).toMatchObject({
      verdict: "malicious",
      basis: "score",
    });
  });

  it("builds artifact-only prompt context from a fetched corpus row", () => {
    const row = makeRow({ slug: "demo", securityLevel: "High" });
    const context = buildSkillEvalContextFromRow(row);

    expect(context).toMatchObject({
      slug: "demo",
      displayName: "demo",
      version: "1.0.0",
      summary: "Demo skill",
      files: [{ path: "skills/acme/demo/SKILL.md" }],
    });
    expect(context?.parsed.clawdis).toMatchObject({
      requires: {
        env: ["DEMO_TOKEN"],
      },
    });
    expect(context?.fileContents).toEqual([]);
  });

  it("flags unsupported execution and runtime claims", () => {
    const claims = findUnsupportedRuntimeClaims(
      "We ran the skill in sandbox execution and observed runtime behavior.",
    );

    expect(claims.map((claim) => claim.pattern)).toContain("claims code was executed");
    expect(claims.map((claim) => claim.pattern)).toContain("claims a runtime probe");
    expect(claims.map((claim) => claim.pattern)).toContain("claims observed runtime behavior");
  });

  it("compares old and new prompt outputs against SkillTester references", async () => {
    const rows = [
      makeRow({ slug: "benign-demo", securityLevel: "High" }),
      makeRow({ slug: "risky-demo", securityLevel: "Dangerous" }),
      makeRow({ slug: "missing-demo", contentStatus: "missing", securityLevel: "High" }),
    ];
    const runner = async (request: PromptRunRequest): Promise<PromptRunResult> => {
      if (request.kind === "old") {
        return {
          raw:
            request.row.resolved.slug === "benign-demo"
              ? legacyResponse("suspicious")
              : legacyResponse("benign"),
          cache: "disabled",
        };
      }
      return {
        raw:
          request.row.resolved.slug === "benign-demo"
            ? asiResponse("benign")
            : asiResponse("suspicious"),
        cache: "disabled",
      };
    };

    const report = await runComparison(
      {
        corpusFile: "fixture.jsonl",
        outputDir: "unused",
        cacheDir: "unused",
        model: "test-model",
        reasoningEffort: "xhigh",
        serviceTier: "priority",
        useCache: false,
        mock: false,
        writeReports: false,
        rows,
      },
      runner,
    );

    expect(report.counts).toMatchObject({
      corpusRows: 3,
      evaluatedRows: 2,
      skippedRows: 1,
      referenceKnownRows: 2,
      promptDisagreements: 2,
    });
    expect(report).toMatchObject({
      model: "test-model",
      reasoningEffort: "xhigh",
      serviceTier: "priority",
    });
    expect(report.prompts.old.metrics.falsePositivesOnBenign).toBe(1);
    expect(report.prompts.old.metrics.riskyReferenceDetected).toBe(0);
    expect(report.prompts.new.metrics.falsePositivesOnBenign).toBe(0);
    expect(report.prompts.new.metrics.riskyReferenceDetected).toBe(1);
    expect(report.prompts.new.metrics.evidenceQuality.evidenceBackedFindings).toBe(1);
    expect(JSON.stringify(report)).not.toContain(["supply", "chain"].join("_"));
  });

  it("runs rows with bounded concurrency and clusters false-positive themes", async () => {
    const rows = [
      makeRow({ slug: "cli-demo", securityLevel: "High" }),
      makeRow({ slug: "safe-a", securityLevel: "High" }),
      makeRow({ slug: "safe-b", securityLevel: "High" }),
    ];
    const activeBySlug = new Map<string, number>();
    let maxActiveRows = 0;
    const runner = async (request: PromptRunRequest): Promise<PromptRunResult> => {
      const slug = request.row.resolved.slug ?? "unknown";
      activeBySlug.set(slug, (activeBySlug.get(slug) ?? 0) + 1);
      maxActiveRows = Math.max(maxActiveRows, activeBySlug.size);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeBySlug.set(slug, (activeBySlug.get(slug) ?? 1) - 1);
      if (activeBySlug.get(slug) === 0) activeBySlug.delete(slug);

      return {
        raw:
          request.kind === "new" && slug === "cli-demo"
            ? cliFalsePositiveResponse()
            : request.kind === "new"
              ? asiResponse("benign")
              : legacyResponse("benign"),
        cache: "disabled",
      };
    };

    const report = await runComparison(
      {
        corpusFile: "fixture.jsonl",
        outputDir: "unused",
        cacheDir: "unused",
        model: "test-model",
        reasoningEffort: "xhigh",
        concurrency: 2,
        useCache: false,
        mock: false,
        writeReports: false,
        rows,
      },
      runner,
    );

    expect(report.concurrency).toBe(2);
    expect(maxActiveRows).toBeGreaterThan(1);
    expect(maxActiveRows).toBeLessThanOrEqual(2);
    expect(report.prompts.new.metrics.falsePositivesOnBenign).toBe(1);
    expect(report.falsePositiveAnalysis.new.themes.map((theme) => theme.id)).toContain(
      "cli_install_or_execution_surface",
    );
    expect(report.falsePositiveAnalysis.new.suggestedFewShotCandidates[0]).toMatchObject({
      rowId: "acme/cli-demo@1.0.0",
      referenceVerdict: "benign",
    });
  });

  it("selects a specific corpus row by stable target aliases", () => {
    const rows = [
      makeRow({ slug: "benign-demo", securityLevel: "High" }),
      makeRow({ slug: "risky-demo", securityLevel: "Dangerous" }),
    ];

    expect(
      selectCorpusRowsByTargets(rows, ["acme/risky-demo@1.0.0"]).map((row) => row.resolved.slug),
    ).toEqual(["risky-demo"]);
    expect(
      selectCorpusRowsByTargets(rows, ["risky-demo-1.0.0"]).map((row) => row.resolved.slug),
    ).toEqual(["risky-demo"]);
    expect(() => selectCorpusRowsByTargets(rows, ["missing-demo"])).toThrow(
      "No corpus row matched",
    );
  });

  it("can restrict comparisons to SkillTester risky reference rows", async () => {
    const rows = [
      makeRow({ slug: "benign-demo", securityLevel: "High" }),
      makeRow({ slug: "review-demo", securityLevel: "Needs review" }),
      makeRow({ slug: "risky-demo", securityLevel: "Dangerous" }),
      makeRow({ slug: "unknown-demo" }),
    ];
    expect(selectCorpusRowsBySkillTesterRisk(rows, true).map((row) => row.resolved.slug)).toEqual([
      "review-demo",
      "risky-demo",
    ]);

    const seenSlugs: string[] = [];
    const runner = async (request: PromptRunRequest): Promise<PromptRunResult> => {
      seenSlugs.push(`${request.kind}:${request.row.resolved.slug}`);
      return {
        raw: request.kind === "new" ? asiResponse("suspicious") : legacyResponse("suspicious"),
        cache: "disabled",
      };
    };

    const report = await runComparison(
      {
        corpusFile: "fixture.jsonl",
        outputDir: "unused",
        cacheDir: "unused",
        model: "test-model",
        reasoningEffort: "xhigh",
        skilltesterRiskyOnly: true,
        limit: 1,
        useCache: false,
        mock: false,
        writeReports: false,
        rows,
      },
      runner,
    );

    expect(report.counts.evaluatedRows).toBe(1);
    expect(report.rows[0]).toMatchObject({
      id: "acme/review-demo@1.0.0",
      reference: { verdict: "suspicious" },
      new: { verdict: "suspicious" },
    });
    expect(new Set(seenSlugs)).toEqual(new Set(["old:review-demo", "new:review-demo"]));
  });
});
