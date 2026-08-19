/* @vitest-environment node */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildTier3Commands,
  discoverSkillEvals,
  resolveRepositoryPath,
} from "./skill-evaluation-runtime";

const temporaryDirectories: string[] = [];

async function makeSkill() {
  const directory = await mkdtemp(join(tmpdir(), "clawhub-skill-evals-test-"));
  temporaryDirectories.push(directory);
  await writeFile(join(directory, "SKILL.md"), "---\nname: demo\n---\n");
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("SkillEvaluator eval discovery", () => {
  it("discovers the canonical evals/evals.json contract", async () => {
    const skill = await makeSkill();
    await mkdir(join(skill, "evals"));
    await writeFile(join(skill, "evals/evals.json"), '{"skill_name":"demo","evals":[]}');

    expect(await discoverSkillEvals(skill)).toEqual({
      status: "ready",
      taskSource: "evals_json",
      evalDirectory: join(skill, "evals"),
      datasetPath: join(skill, "evals/evals.json"),
    });
  });

  it.each(["evals.jsonl", "evals.yaml", "evals.yml"])(
    "discovers the evaluator-supported %s dataset",
    async (filename) => {
      const skill = await makeSkill();
      await mkdir(join(skill, "evals"));
      await writeFile(join(skill, "evals", filename), "[]");

      expect(await discoverSkillEvals(skill)).toEqual({
        status: "ready",
        taskSource: "evals_json",
        evalDirectory: join(skill, "evals"),
        datasetPath: join(skill, "evals", filename),
      });
    },
  );

  it("skips skills without an upstream Tier 3 dataset", async () => {
    const skill = await makeSkill();

    expect(await discoverSkillEvals(skill)).toMatchObject({
      status: "skipped",
      reason: "no-evals",
    });
  });

  it("does not guess that a nested evals.json is the skill dataset", async () => {
    const skill = await makeSkill();
    await mkdir(join(skill, "fixtures"), { recursive: true });
    await writeFile(join(skill, "fixtures/evals.json"), "{}");

    expect(await discoverSkillEvals(skill)).toMatchObject({
      status: "skipped",
      reason: "unsupported-eval-layout",
    });
  });

  it("skips an ambiguous config filename pair", async () => {
    const skill = await makeSkill();
    await mkdir(join(skill, "evals"));
    await writeFile(join(skill, "evals/evals.json"), "{}");
    await writeFile(join(skill, "evals/config.yml"), "schema_version: 1\n");
    await writeFile(join(skill, "evals/config.yaml"), "schema_version: 1\n");

    expect(await discoverSkillEvals(skill)).toMatchObject({
      status: "skipped",
      reason: "ambiguous-evals-config",
    });
  });

  it("honors the configured native Harbor source", async () => {
    const skill = await makeSkill();
    await mkdir(join(skill, "evals/harbor"), { recursive: true });
    await writeFile(
      join(skill, "evals/config.yml"),
      "schema_version: 1\nharbor:\n  task_source: native_harbor\n",
    );

    expect(await discoverSkillEvals(skill)).toEqual({
      status: "ready",
      taskSource: "native_harbor",
      evalDirectory: join(skill, "evals"),
      configPath: join(skill, "evals/config.yml"),
    });
  });

  it("reports a config and source mismatch", async () => {
    const skill = await makeSkill();
    await mkdir(join(skill, "evals"));
    await writeFile(
      join(skill, "evals/config.yml"),
      "schema_version: 1\nharbor:\n  task_source: evals_json\n",
    );

    expect(await discoverSkillEvals(skill)).toMatchObject({
      status: "skipped",
      reason: "eval-source-config-mismatch",
    });
  });
});

describe("SkillEvaluator worker command contract", () => {
  it("pins the subject model, two full attempts, baseline, and Docker", () => {
    const commands = buildTier3Commands({
      evaluatorProject: "/evaluator",
      skillDirectory: "/checkout/skills/demo",
      resultsDirectory: "/results",
      agent: "codex",
      agentModel: "gpt-5.4-mini",
      attempts: 2,
      environment: "docker",
    });

    expect(commands.validate).toEqual([
      "uv",
      "run",
      "--project",
      "/evaluator",
      "--extra",
      "tier3",
      "skillevaluator",
      "tier3",
      "validate",
      "/checkout/skills/demo",
      "--json",
    ]);
    expect(commands.evaluate).toEqual(
      expect.arrayContaining([
        "--agents",
        "codex",
        "--env-mode",
        "docker",
        "--agent-model",
        "codex=gpt-5.4-mini",
        "--n-attempts",
        "2",
        "--no-stop-on-pass",
      ]),
    );
    expect(commands.evaluate).not.toContain("--skip-baseline");
  });

  it("keeps source paths inside the exact repository checkout", () => {
    expect(resolveRepositoryPath("/checkout", "skills/demo")).toBe("/checkout/skills/demo");
    expect(() => resolveRepositoryPath("/checkout", "../escape")).toThrow("escaped its repository");
    expect(() => resolveRepositoryPath("/checkout", "/absolute")).toThrow("repository-relative");
  });
});
