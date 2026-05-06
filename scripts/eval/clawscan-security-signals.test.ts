/* @vitest-environment node */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSkillEvalContextFromRow,
  corpusRowFromHfSecuritySignalsRow,
  parseArgs,
  readCorpusJsonl,
  readHfJsonl,
  runComparison,
  type CorpusRow,
} from "./clawscan-security-signals";

function corpusRow(overrides: Partial<CorpusRow> = {}): CorpusRow {
  return {
    schema_version: "clawhub-security-signals-corpus-v1",
    corpus: "clawhub-security-signals",
    source: "ClawHub security signals",
    content_status: "fetched",
    resolved: {
      owner: "openclaw",
      slug: "demo-skill",
      version: "1.0.0",
      canonical_url: "https://clawhub.ai/openclaw/demo-skill",
    },
    artifact: {
      path: "skills/demo-skill/SKILL.md",
      skill_md_bytes: 128,
      skill_md_content:
        "---\nname: Demo Skill\ndescription: Helps inspect local project files.\n---\nUse this skill to inspect project files with user approval.",
    },
    securitySignals: {
      summary: {
        skill_name: "demo-skill",
        full_name: "OpenClaw Demo Skill",
        description: "Helps inspect local project files.",
        security_level: "high security",
      },
      scores: {
        security: 95,
        security_level: "high security",
      },
      security: {
        level: "high security",
        score: 95,
      },
      source_urls: {
        detail_api_url: "https://example.test/detail.json",
        skill_url: "https://example.test/demo-skill",
      },
      timestamps: {
        evaluation_timestamp: "2026-04-30T00:00:00Z",
      },
    },
    reference_labels: {
      security_level: "high security",
      security_score: 95,
    },
    ...overrides,
  };
}

describe("clawscan security signals eval", () => {
  it("parses data source CLI flags", () => {
    const parsed = parseArgs([
      "--corpus",
      "../clawhub-security/eval/corpora/clawhub-security-signals/corpus.jsonl",
      "--output-dir",
      "/tmp/clawscan-results",
      "--cache-dir",
      "/tmp/clawscan-cache",
      "--limit",
      "2",
      "--offset",
      "8",
      "--concurrency",
      "3",
      "--prompt",
      "both",
      "--hf-split",
      "eval_holdout",
      "--hf-jsonl",
      "/tmp/hf-train.jsonl",
      "--target",
      "openclaw/demo-skill@1.0.0",
      "--mock",
    ]);

    expect(parsed.corpusFile).toContain("clawhub-security-signals/corpus.jsonl");
    expect(parsed.outputDir).toBe("/tmp/clawscan-results");
    expect(parsed.cacheDir).toBe("/tmp/clawscan-cache");
    expect(parsed.limit).toBe(2);
    expect(parsed.offset).toBe(8);
    expect(parsed.concurrency).toBe(3);
    expect(parsed.promptMode).toBe("both");
    expect(parsed.hfSplit).toBe("eval_holdout");
    expect(parsed.hfJsonlFile).toBe("/tmp/hf-train.jsonl");
    expect(parsed.targets).toEqual(["openclaw/demo-skill@1.0.0"]);
    expect(parsed.mock).toBe(true);
  });

  it("defaults to the private HF eval_holdout dataset", () => {
    const previous = process.env.CLAWHUB_SECURITY_EVAL_HF_DATASET;
    process.env.CLAWHUB_SECURITY_EVAL_HF_DATASET = "example/private-dataset";

    try {
      const parsed = parseArgs(["--mock", "--limit", "2"]);

      expect(parsed.corpusFile).toBeNull();
      expect(parsed.hfDataset).toBe("example/private-dataset");
      expect(parsed.hfConfig).toBe("default");
      expect(parsed.hfSplit).toBe("eval_holdout");
    } finally {
      if (previous === undefined) {
        delete process.env.CLAWHUB_SECURITY_EVAL_HF_DATASET;
      } else {
        process.env.CLAWHUB_SECURITY_EVAL_HF_DATASET = previous;
      }
    }
  });

  it("converts HF eval_holdout rows into eval corpus rows", () => {
    const converted = corpusRowFromHfSecuritySignalsRow(
      {
        uuid: "row-1",
        skill: "---\nname: HF Skill\n---\nUse the skill carefully.",
        label: "suspicious",
        metadata: {
          source: {
            source_table: "securitySignalsCorpus",
            public_name: "HF Skill",
            public_slug: "hf-skill",
            version: "1.2.3",
            created_at: "2026-04-30T00:00:00Z",
          },
          split: { name: "eval_holdout" },
        },
      },
      7,
    );

    expect(converted).toMatchObject({
      source: "HuggingFace",
      content_status: "fetched",
      resolved: {
        owner: "securitySignalsCorpus",
        slug: "hf-skill",
        version: "1.2.3",
      },
      reference_labels: {
        security_level: "moderate security",
      },
    });
    expect(converted.artifact.skill_md_content).toContain("Use the skill carefully.");
  });

  it("reads corpus JSONL and converts fetched rows to SkillEvalContext", async () => {
    const root = await mkdtemp(join(tmpdir(), "clawhub-clawscan-eval-"));
    const corpusFile = join(root, "corpus.jsonl");
    await writeFile(corpusFile, `${JSON.stringify(corpusRow())}\n`, "utf8");

    const rows = await readCorpusJsonl(corpusFile);
    const context = buildSkillEvalContextFromRow(rows[0]);

    expect(rows).toHaveLength(1);
    expect(context).toMatchObject({
      slug: "demo-skill",
      displayName: "Demo Skill",
      ownerUserId: "openclaw",
      version: "1.0.0",
    });
    expect(context?.skillMdContent).toContain("user approval");
  });

  it("skips missing rows and runs mock comparisons without Convex access", async () => {
    const fetched = corpusRow();
    const missing = corpusRow({
      content_status: "missing",
      artifact: { missing_reason: "not found in source repo" },
      resolved: { slug: "missing-skill" },
    });

    const report = await runComparison({
      corpusFile: "/unused/corpus.jsonl",
      hfJsonlFile: null,
      hfDataset: "example/private-dataset",
      hfConfig: "default",
      hfSplit: "eval_holdout",
      outputDir: "/unused/results",
      cacheDir: "/unused/cache",
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      serviceTier: "priority",
      concurrency: 1,
      promptMode: "both",
      useCache: false,
      mock: true,
      writeReports: false,
      rows: [fetched, missing],
    });

    expect(report.corpusSchemaVersion).toBe("clawhub-security-signals-corpus-v1");
    expect(report.counts).toMatchObject({
      corpusRows: 2,
      evaluatedRows: 1,
      skippedRows: 1,
      referenceKnownRows: 1,
    });
    expect(report.prompts.old.systemPromptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.prompts.new.systemPromptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.rows[0].old.cache).toBe("mock");
    expect(report.rows[0].new.cache).toBe("mock");
    expect(report.skipped[0]).toMatchObject({
      slug: "missing-skill",
      reason: "not found in source repo",
    });
  });

  it("uses moderation_consensus before top-level labels for local HF rows", async () => {
    const root = await mkdtemp(join(tmpdir(), "clawhub-hf-jsonl-"));
    const hfJsonl = join(root, "train.jsonl");
    await writeFile(
      hfJsonl,
      `${JSON.stringify({
        uuid: "row-1",
        skill: "---\nname: HF Skill\n---\nUse the skill carefully.",
        label: "suspicious",
        score_consensus: 0,
        has_skilltester: true,
        data: {
          labels: [
            {
              label: "clean",
              label_source: "moderation_consensus",
              raw_label: "clean",
              score: 0,
            },
            {
              label: "clean",
              label_source: "skilltester_security",
              raw_label: "clean",
              score: 0,
            },
          ],
        },
        metadata: {
          source: {
            source_table: "skillVersions",
            public_name: "HF Skill",
            public_slug: "hf-skill",
            version: "1.2.3",
            created_at: "2026-04-30T00:00:00Z",
          },
        },
      })}\n`,
      "utf8",
    );

    const rows = await readHfJsonl(hfJsonl, "train");

    expect(rows[0]).toMatchObject({
      reference_labels: {
        source: "moderation_consensus",
        security_level: "high security",
        security_score: 100,
        moderation_consensus_level: "high security",
        skilltester_security_level: "high security",
      },
    });
  });

  it("tracks false positives on SkillTester pass rows", async () => {
    const row = corpusRow({
      reference_labels: {
        source: "moderation_consensus",
        security_level: "high security",
        security_score: 100,
        moderation_consensus_level: "high security",
        skilltester_security_level: "high security",
      },
    });

    const report = await runComparison(
      {
        corpusFile: null,
        hfJsonlFile: null,
        hfDataset: null,
        hfConfig: "default",
        hfSplit: "eval_holdout",
        outputDir: "/unused/results",
        cacheDir: "/unused/cache",
        model: "gpt-5.5",
        reasoningEffort: "xhigh",
        serviceTier: "priority",
        concurrency: 1,
        useCache: false,
        mock: false,
        writeReports: false,
        rows: [row],
      },
      async (request) => ({
        cache: "disabled",
        raw: JSON.stringify({
          verdict: request.kind === "new" ? "suspicious" : "benign",
          confidence: "medium",
          summary: "Synthetic harness result.",
          dimensions: {
            purpose_capability: { status: "ok", detail: "Synthetic output." },
          },
          user_guidance: "Synthetic output.",
        }),
      }),
    );

    expect(report.prompts.new.metrics.falsePositivesOnBenign).toBe(1);
    expect(report.prompts.new.metrics.skillTesterPassRows).toBe(1);
    expect(report.prompts.new.metrics.falsePositivesOnSkillTesterPass).toBe(1);
    expect(report.prompts.old.metrics.falsePositivesOnSkillTesterPass).toBe(0);
  });
});
