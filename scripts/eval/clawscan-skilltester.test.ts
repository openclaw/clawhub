/* @vitest-environment node */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSkillEvalContextFromRow,
  corpusRowFromHfEvalHoldoutRow,
  parseArgs,
  readCorpusJsonl,
  runComparison,
  type CorpusRow,
} from "./clawscan-skilltester";

function corpusRow(overrides: Partial<CorpusRow> = {}): CorpusRow {
  return {
    schema_version: "skilltester-clawhub-corpus-v1",
    corpus: "skilltester-clawhub",
    source: "SkillTester",
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
    skilltester: {
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

describe("clawscan skilltester eval", () => {
  it("parses data source CLI flags", () => {
    const parsed = parseArgs([
      "--corpus",
      "../clawhub-security/eval/corpora/skilltester-clawhub/corpus.jsonl",
      "--output-dir",
      "/tmp/clawscan-results",
      "--cache-dir",
      "/tmp/clawscan-cache",
      "--limit",
      "2",
      "--concurrency",
      "3",
      "--target",
      "openclaw/demo-skill@1.0.0",
      "--mock",
    ]);

    expect(parsed.corpusFile).toContain("skilltester-clawhub/corpus.jsonl");
    expect(parsed.outputDir).toBe("/tmp/clawscan-results");
    expect(parsed.cacheDir).toBe("/tmp/clawscan-cache");
    expect(parsed.limit).toBe(2);
    expect(parsed.concurrency).toBe(3);
    expect(parsed.targets).toEqual(["openclaw/demo-skill@1.0.0"]);
    expect(parsed.mock).toBe(true);
  });

  it("defaults to the private HF eval_holdout dataset", () => {
    const parsed = parseArgs(["--mock", "--limit", "2"]);

    expect(parsed.corpusFile).toBeNull();
    expect(parsed.hfDataset).toBe("OpenClaw/clawhub-security-signals-private");
    expect(parsed.hfConfig).toBe("default");
  });

  it("converts HF eval_holdout rows into eval corpus rows", () => {
    const converted = corpusRowFromHfEvalHoldoutRow(
      {
        uuid: "row-1",
        skill: "---\nname: HF Skill\n---\nUse the skill carefully.",
        label: "suspicious",
        metadata: {
          source: {
            source_table: "skilltesterCorpus",
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
        owner: "skilltesterCorpus",
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
      hfDataset: "OpenClaw/clawhub-security-signals-private",
      hfConfig: "default",
      outputDir: "/unused/results",
      cacheDir: "/unused/cache",
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      serviceTier: "priority",
      concurrency: 1,
      useCache: false,
      mock: true,
      writeReports: false,
      rows: [fetched, missing],
    });

    expect(report.corpusSchemaVersion).toBe("skilltester-clawhub-corpus-v1");
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
});
