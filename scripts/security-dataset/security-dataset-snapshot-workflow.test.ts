/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

describe("security-dataset-snapshot workflow", () => {
  it("keeps the scheduled dataset snapshot below the runner registration budget", async () => {
    const workflow = parseYaml(
      await readFile(".github/workflows/security-dataset-snapshot.yml", "utf8"),
    ) as {
      jobs: {
        "export-security-dataset-shards": {
          strategy?: { "max-parallel"?: number };
        };
        "plan-security-dataset": {
          if?: string;
          env?: Record<string, unknown>;
          steps: Array<{ id?: string; run?: string }>;
        };
        "publish-existing-security-dataset-shards": {
          if?: string;
          steps: Array<{ name?: string; run?: string }>;
        };
      };
      on?: {
        workflow_dispatch?: {
          inputs?: Record<string, { default?: string }>;
        };
      };
      permissions?: Record<string, string>;
      concurrency?: {
        group?: string;
        "cancel-in-progress"?: string | boolean;
      };
    };

    const planJob = workflow.jobs["plan-security-dataset"];
    const exportJob = workflow.jobs["export-security-dataset-shards"];
    const publishExistingJob = workflow.jobs["publish-existing-security-dataset-shards"];
    const planStep = planJob.steps.find((step) => step.id === "plan");

    expect(workflow.permissions?.actions).toBe("read");
    expect(workflow.on?.workflow_dispatch?.inputs?.shards?.default).toBe("48");
    expect(workflow.on?.workflow_dispatch?.inputs?.["reuse-shards-run-id"]?.default).toBe("");
    expect(workflow.concurrency?.group).toContain("manual-dry-run");
    expect(workflow.concurrency?.["cancel-in-progress"]).toContain("inputs.upload != 'true'");
    expect(planJob.if).toContain("reuse-shards-run-id");
    expect(planJob.env?.SNAPSHOT_SHARDS).toBe("${{ inputs.shards || '48' }}");
    expect(planJob.env?.HF_DATASET_REPO).toBe("OpenClaw/clawhub-security-signals-live");
    expect(planJob.env?.SNAPSHOT_MAX_SHARDS_PER_SOURCE).toBe(
      "${{ vars.SECURITY_DATASET_MAX_SHARDS_PER_SOURCE || '64' }}",
    );
    expect(planJob.env?.SNAPSHOT_MAX_MATRIX_JOBS).toBe(
      "${{ vars.SECURITY_DATASET_MAX_MATRIX_JOBS || '128' }}",
    );
    expect(planJob.steps.find((step) => step.run?.includes("Maximum matrix jobs"))?.run).toContain(
      "requested ${shards} shards per source kind",
    );
    expect(planJob.steps.find((step) => step.run?.includes("Maximum matrix jobs"))?.run).toContain(
      "BigInt(shards) > BigInt(maxShards)",
    );
    expect(planJob.steps.find((step) => step.run?.includes("Maximum matrix jobs"))?.run).toContain(
      "SECURITY_DATASET_MAX_MATRIX_JOBS must be a positive integer",
    );
    expect(planStep?.run).toContain("planned ${shardCount} dataset shard jobs");
    expect(planStep?.run).toContain("BigInt(shardCount) > BigInt(maxJobs)");
    expect(exportJob.strategy?.["max-parallel"]).toBe(12);
    expect(publishExistingJob.if).toContain("reuse-shards-run-id");
    expect(
      publishExistingJob.steps.find((step) => step.name === "Download existing shard artifacts")
        ?.run,
    ).toContain('gh run download "$SOURCE_SHARDS_RUN_ID"');
  });
});
