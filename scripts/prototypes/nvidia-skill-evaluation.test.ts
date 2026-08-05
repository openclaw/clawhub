/* @vitest-environment node */

import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEvaluatorProcessEnvironment,
  buildLocalEvaluationArtifactBaseUrl,
  buildTier3EvaluateInvocation,
  discoverSkillEvals,
  planOfficialSkillEvaluation,
  updateLocalEvaluationIndex,
} from "./nvidia-skill-evaluation";

async function makeSkill(files: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "clawhub-skill-eval-"));
  const skillPath = join(root, "skills", "demo");
  await mkdir(skillPath, { recursive: true });
  await writeFile(
    join(skillPath, "SKILL.md"),
    "---\nname: demo\ndescription: Demo skill\n---\n",
    "utf8",
  );
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(skillPath, relativePath);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return { root, skillPath };
}

describe("official skill evaluation planning", () => {
  it("runs only when ClawHub observes a changed skill content hash", async () => {
    const { root } = await makeSkill({
      "evals/evals.json": JSON.stringify({ skill_name: "demo", evals: [{ id: "one" }] }),
    });

    const changed = await planOfficialSkillEvaluation({
      checkoutPath: root,
      sourceRepo: "nvidia/skills",
      sourceCommit: "a".repeat(40),
      sourcePath: "skills/demo",
      contentHash: "new-content",
      previousContentHash: "old-content",
    });
    const unchanged = await planOfficialSkillEvaluation({
      checkoutPath: root,
      sourceRepo: "nvidia/skills",
      sourceCommit: "a".repeat(40),
      sourcePath: "skills/demo",
      contentHash: "new-content",
      previousContentHash: "new-content",
    });

    expect(changed).toMatchObject({ action: "run", evals: { status: "ready" } });
    expect(unchanged).toMatchObject({
      action: "skip",
      reason: "unchanged-version",
    });
  });

  it("uses one canonical repository-relative skill path", async () => {
    const { root } = await makeSkill({
      "evals/evals.json": JSON.stringify({ skill_name: "demo", evals: [{ id: "one" }] }),
    });

    await expect(
      planOfficialSkillEvaluation({
        checkoutPath: root,
        sourceRepo: "nvidia/skills",
        sourceCommit: "a".repeat(40),
        sourcePath: "./skills/other/../demo",
        contentHash: "new-content",
        previousContentHash: null,
      }),
    ).resolves.toMatchObject({ action: "run", sourcePath: "skills/demo" });
  });

  it("does not evaluate a repository outside the official source allowlist", async () => {
    const { root } = await makeSkill({
      "evals/evals.json": JSON.stringify({ skill_name: "demo", evals: [{ id: "one" }] }),
    });

    await expect(
      planOfficialSkillEvaluation({
        checkoutPath: root,
        sourceRepo: "example/community-skills",
        sourceCommit: "a".repeat(40),
        sourcePath: "skills/demo",
        contentHash: "new-content",
        previousContentHash: null,
      }),
    ).resolves.toMatchObject({ action: "skip", reason: "unapproved-source" });
  });
});

describe("SkillEvaluator eval discovery", () => {
  it("resolves evals from the exact monorepo skill directory", async () => {
    const { skillPath } = await makeSkill({
      "evals/evals.json": JSON.stringify({ skill_name: "demo", evals: [{ id: "one" }] }),
      "evals/config.yml": "schema_version: 1\n",
    });

    await expect(discoverSkillEvals(skillPath)).resolves.toMatchObject({
      status: "ready",
      evalDirectory: join(skillPath, "evals"),
      datasetPath: join(skillPath, "evals", "evals.json"),
      configPath: join(skillPath, "evals", "config.yml"),
    });
  });

  it("skips clearly when the exact skill directory has no eval source", async () => {
    const { skillPath } = await makeSkill();

    await expect(discoverSkillEvals(skillPath)).resolves.toEqual({
      status: "skipped",
      reason: "no-evals",
      message: "No SkillEvaluator dataset or native Harbor tasks were found in evals/.",
    });
  });

  it("skips rather than choosing between multiple dataset aliases", async () => {
    const { skillPath } = await makeSkill({
      "evals/evals.json": JSON.stringify({ skill_name: "demo", evals: [{ id: "one" }] }),
      "evals/evals.yaml": "skill_name: demo\nevals:\n  - id: two\n",
    });

    await expect(discoverSkillEvals(skillPath)).resolves.toMatchObject({
      status: "skipped",
      reason: "ambiguous-evals",
      candidates: [join(skillPath, "evals", "evals.json"), join(skillPath, "evals", "evals.yaml")],
    });
  });

  it("skips rather than choosing between both config aliases", async () => {
    const { skillPath } = await makeSkill({
      "evals/evals.json": JSON.stringify({ skill_name: "demo", evals: [{ id: "one" }] }),
      "evals/config.yml": "schema_version: 1\n",
      "evals/config.yaml": "schema_version: 1\n",
    });

    await expect(discoverSkillEvals(skillPath)).resolves.toMatchObject({
      status: "skipped",
      reason: "ambiguous-evals-config",
    });
  });

  it("honors an explicit native Harbor task source when both layouts exist", async () => {
    const { skillPath } = await makeSkill({
      "evals/evals.json": JSON.stringify({ skill_name: "demo", evals: [{ id: "one" }] }),
      "evals/config.yml": "schema_version: 1\nharbor:\n  task_source: native_harbor\n",
      "evals/harbor/dataset.toml": "[metadata]\nname = 'demo'\n",
    });

    await expect(discoverSkillEvals(skillPath)).resolves.toMatchObject({
      status: "ready",
      taskSource: "native_harbor",
      configPath: join(skillPath, "evals", "config.yml"),
    });
  });

  it("uses SkillEvaluator's validated auto precedence when both layouts exist", async () => {
    const { skillPath } = await makeSkill({
      "evals/evals.json": JSON.stringify({ skill_name: "demo", evals: [{ id: "one" }] }),
      "evals/harbor/dataset.toml": "[metadata]\nname = 'demo'\n",
    });

    await expect(discoverSkillEvals(skillPath)).resolves.toMatchObject({
      status: "ready",
      taskSource: "evals_json",
      datasetPath: join(skillPath, "evals", "evals.json"),
    });
  });

  it("skips a configured task source whose files are missing", async () => {
    const { skillPath } = await makeSkill({
      "evals/config.yml": "schema_version: 1\nharbor:\n  task_source: native_harbor\n",
    });

    await expect(discoverSkillEvals(skillPath)).resolves.toMatchObject({
      status: "skipped",
      reason: "eval-source-config-mismatch",
    });
  });

  it("distinguishes NVIDIA catalog eval data that Tier 3 cannot consume directly", async () => {
    const { skillPath } = await makeSkill({
      "benchmark/evals.json": JSON.stringify([{ id: "one", prompt: "Demo" }]),
    });

    await expect(discoverSkillEvals(skillPath)).resolves.toMatchObject({
      status: "skipped",
      reason: "unsupported-eval-layout",
      candidates: [join(skillPath, "benchmark", "evals.json")],
    });
  });
});

describe("canonical SkillEvaluator execution", () => {
  it("passes only runtime essentials and explicitly scoped evaluator credentials", () => {
    expect(
      buildEvaluatorProcessEnvironment(
        {
          PATH: "/usr/bin",
          HOME: "/tmp/evaluator-home",
          OPENAI_API_KEY: "evaluator-key",
          GITHUB_TOKEN: "must-not-leak",
          AWS_SECRET_ACCESS_KEY: "must-not-leak",
          NODE_OPTIONS: "--require /tmp/inject.js",
        },
        {
          SKILL_EVAL_LLM_MODEL: "gpt-5.4-mini",
          SKILL_EVAL_LLM_PROVIDER: "openai",
        },
        "/tmp/checkout",
      ),
    ).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/evaluator-home",
      OPENAI_API_KEY: "evaluator-key",
      PWD: "/tmp/checkout",
      SKILL_EVAL_LLM_MODEL: "gpt-5.4-mini",
      SKILL_EVAL_LLM_PROVIDER: "openai",
    });
  });

  it("rejects an unscoped invocation environment variable", () => {
    expect(() =>
      buildEvaluatorProcessEnvironment(
        { PATH: "/usr/bin" },
        { GITHUB_TOKEN: "must-not-leak" },
        "/tmp/checkout",
      ),
    ).toThrow("Unsupported SkillEvaluator environment variable: GITHUB_TOKEN");
  });

  it("pins the evaluator and Codex model for a one-attempt Tier 3 smoke run", () => {
    expect(
      buildTier3EvaluateInvocation({
        evaluatorRepoPath: "/tmp/SkillEvaluator",
        skillDirectory: "/tmp/skills/skills/doca-dpa",
        resultsDirectory: "/tmp/results",
        model: "gpt-5.4-mini",
      }),
    ).toEqual({
      command: [
        "uv",
        "run",
        "--project",
        "/tmp/SkillEvaluator",
        "skillevaluator",
        "tier3",
        "evaluate",
        "/tmp/skills/skills/doca-dpa",
        "--agents",
        "codex",
        "--env-mode",
        "local",
        "--agent-model",
        "codex=gpt-5.4-mini",
        "--n-attempts",
        "1",
        "--n-concurrent",
        "1",
        "--max-agents",
        "1",
        "--progress",
        "plain",
        "--results-dir",
        "/tmp/results",
      ],
      environment: {
        SKILL_EVAL_LLM_MODEL: "gpt-5.4-mini",
        SKILL_EVAL_LLM_PROVIDER: "openai",
      },
    });
  });
});

describe("local evaluation artifact index", () => {
  it("URL-encodes every published artifact identity segment", () => {
    expect(
      buildLocalEvaluationArtifactBaseUrl("nvidia/skills", "b".repeat(64), "skills/doca#dpa/café"),
    ).toBe(`/__skill-evaluator-demo/nvidia/skills/${"b".repeat(64)}/skills/doca%23dpa/caf%C3%A9`);
  });

  it("maps each observed source commit to reusable skill-content artifacts", async () => {
    const webRoot = await mkdtemp(join(tmpdir(), "clawhub-skill-eval-web-"));
    const contentHash = "b".repeat(64);
    for (const commit of ["c".repeat(40), "a".repeat(40)]) {
      await updateLocalEvaluationIndex({
        webRoot,
        repository: "nvidia/skills",
        commit,
        sourcePath: "skills/doca-dpa",
        contentHash,
      });
    }

    expect(JSON.parse(await readFile(join(webRoot, "index.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      evaluations: [
        {
          repository: "nvidia/skills",
          commit: "a".repeat(40),
          path: "skills/doca-dpa",
          contentHash,
        },
        {
          repository: "nvidia/skills",
          commit: "c".repeat(40),
          path: "skills/doca-dpa",
          contentHash,
        },
      ],
    });
  });
});
