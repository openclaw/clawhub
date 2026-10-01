/* @vitest-environment node */
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  env?: Record<string, unknown>;
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

function expectSecretStepAllowlist(
  steps: WorkflowStep[],
  secretName: string,
  allowedStepNames: string[],
) {
  for (const step of steps) {
    const stepName = step.name ?? step.uses ?? "<unnamed>";
    const hasSecret =
      Object.hasOwn(step.env ?? {}, secretName) ||
      JSON.stringify(step).includes(`secrets.${secretName}`);
    expect(hasSecret, `${secretName} on ${stepName}`).toBe(allowedStepNames.includes(stepName));
  }
}

describe("security-scan-codex workflow", () => {
  it("scans diagnostics with TruffleHog before uploading artifacts", async () => {
    const workflow = parseYaml(
      await readFile(".github/workflows/security-scan-codex.yml", "utf8"),
    ) as {
      concurrency?: {
        "cancel-in-progress"?: boolean;
        group?: string;
      };
      jobs: {
        "codex-security-scan": {
          environment?: string;
          concurrency?: {
            "cancel-in-progress"?: boolean;
            group?: string;
          };
          env?: Record<string, unknown>;
          steps: WorkflowStep[];
          strategy?: {
            "max-parallel"?: number;
            matrix?: {
              lane?: string[];
              shard?: string;
              include?: string;
            };
          };
          "timeout-minutes"?: number;
        };
      };
      on?: {
        repository_dispatch?: { types?: string[] };
        schedule?: Array<{ cron?: string }>;
        workflow_dispatch?: unknown;
      };
    };
    const steps = workflow.jobs["codex-security-scan"].steps;
    const jobEnv = workflow.jobs["codex-security-scan"].env ?? {};
    const scanIndex = steps.findIndex((step) => step.id === "diagnostics_secret_scan");
    const uploadIndex = steps.findIndex((step) => step.uses === "actions/upload-artifact@v7");
    const prepareStep = steps.find(
      (step) => step.name === "Prepare Codex security diagnostics scan",
    );
    const scanStep = steps[scanIndex];
    const uploadStep = steps[uploadIndex];

    expect(scanIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(-1);
    expect(scanIndex).toBeLessThan(uploadIndex);
    expect(scanStep?.run).toContain(
      "ghcr.io/trufflesecurity/trufflehog:3.95.5@sha256:56c25710275c4b8d74c4f1346a5e7c606fa7ff4afe996f680b288d0fae3fcd9c",
    );
    expect(scanStep?.run).toContain("filesystem /scan");
    expect(scanStep?.run).toContain('-v "$PWD/$CODEX_SECURITY_SCAN_DIAGNOSTICS_DIR:/scan:ro"');
    expect(scanStep?.run).toContain("--only-verified");
    expect(scanStep?.run).toContain("--fail");
    expect(scanStep?.run).not.toContain("--debug");
    expect(prepareStep?.if).toBe("${{ !cancelled() }}");
    expect(scanStep?.if).toBe("${{ !cancelled() }}");
    expect(uploadStep?.if).toBe(
      "${{ !cancelled() && steps.diagnostics_secret_scan.outcome == 'success' }}",
    );
    expect(uploadStep?.with?.path).toBe("${{ env.CODEX_SECURITY_SCAN_DIAGNOSTICS_DIR }}");
    expect(uploadStep?.with?.["if-no-files-found"]).toBe("ignore");
    expect(workflow.jobs["codex-security-scan"]["timeout-minutes"]).toBe(60);
    expect(workflow.on?.workflow_dispatch).toBeDefined();
    expect(workflow.on?.repository_dispatch?.types).toEqual(["clawhub-security-scan"]);
    expect(workflow.on?.schedule).toBeUndefined();
    expect(workflow.concurrency).toBeUndefined();
    expect(workflow.jobs["codex-security-scan"].environment).toBe(
      "${{ inputs.environment || 'Production' }}",
    );
    expect(workflow.jobs["codex-security-scan"].concurrency).toEqual({
      group:
        "${{ inputs.environment == 'Staging' && 'deploy-staging' || format('clawhub-security-scan-{0}{1}', matrix.lane == 'shared' && inputs['assigned-jobs'] && 'assigned-' || '', matrix.shard) }}",
      "cancel-in-progress": false,
    });
    expect(workflow.jobs["codex-security-scan"].strategy?.["max-parallel"]).toBe(19);
    const matrix = workflow.jobs["codex-security-scan"].strategy?.matrix;
    expect(matrix?.lane).toEqual(["shared"]);
    expect(matrix?.shard).toContain("inputs['assigned-jobs'] && inputs['shared-workers'] == '18'");
    const choices = [...(matrix?.shard ?? "").matchAll(/'(\[.*?\])'/g)].map((match) =>
      JSON.parse(match[1]),
    );
    expect(choices).toEqual([
      ["shared-0"],
      Array.from({ length: 18 }, (_, n) => `shared-${n}`),
      Array.from({ length: 9 }, (_, n) => `shared-${n}`),
    ]);
    expect(jobEnv.CODEX_SECURITY_SCAN_SHARED_WORKERS).toBe(
      "${{ inputs['shared-workers'] || '9' }}",
    );
    expect(matrix?.include).toBe(
      '${{ fromJSON(inputs.environment == \'Staging\' && \'[]\' || \'[{"lane":"priority","shard":"priority-0"}]\') }}',
    );
    expect(jobEnv.CODEX_SECURITY_SCAN_LANE).toBe("${{ matrix.lane }}");
    expect(jobEnv.CODEX_SECURITY_SCAN_LIMIT).toBe(
      "${{ github.event.client_payload.batch_limit || inputs.limit || inputs['batch-limit'] || '4' }}",
    );
    expect(jobEnv.CODEX_SECURITY_SCAN_MAX_JOBS).toBe(
      "${{ github.event.client_payload.max_jobs || inputs['max-jobs'] || '' }}",
    );
    expect(jobEnv.CODEX_SECURITY_SCAN_MAX_RUNTIME_MINUTES).toBe(
      "${{ github.event.client_payload.max_runtime_minutes || inputs['max-runtime-minutes'] || '12' }}",
    );
    expect(jobEnv.CODEX_SECURITY_SCAN_CLAWSCAN_TIMEOUT_MS).toBe(
      "${{ vars.CODEX_SECURITY_SCAN_CLAWSCAN_TIMEOUT_MS || '900000' }}",
    );
    expect(jobEnv.CODEX_SECURITY_SCAN_CLAWSCAN_SANDBOX).toBe("off");
    expect(jobEnv).not.toHaveProperty("CODEX_SECURITY_SCAN_MODE");
    expect(jobEnv).not.toHaveProperty("CODEX_SECURITY_SCAN_TIMEOUT_MS");
    expect(jobEnv).not.toHaveProperty("CODEX_SECURITY_SCAN_SHADOW_CLAWSCAN");
    expect(jobEnv).not.toHaveProperty("OPENAI_API_KEY");
    expect(jobEnv).not.toHaveProperty("CODEX_API_KEY");
    expect(jobEnv).not.toHaveProperty("LLM_API_KEY");
    expect(jobEnv).not.toHaveProperty("SECURITY_SCAN_WORKER_TOKEN");
    expectSecretStepAllowlist(steps, "CODEX_API_KEY", ["Run Codex security worker"]);
    expectSecretStepAllowlist(steps, "OPENAI_API_KEY", [
      "Authenticate Codex CLI",
      "Run Codex security worker",
    ]);
    expectSecretStepAllowlist(steps, "LLM_API_KEY", ["Run Codex security worker"]);
    expectSecretStepAllowlist(steps, "SECURITY_SCAN_WORKER_TOKEN", ["Run Codex security worker"]);
    expectSecretStepAllowlist(steps, "CONVEX_DEPLOY_KEY", [
      "Check Staging scan target",
      "Prepare Staging scan authentication",
      "Verify Staging scan results",
    ]);
    expectSecretStepAllowlist(steps, "ENDOR_API_CREDENTIALS_KEY", ["Run Codex security worker"]);
    expectSecretStepAllowlist(steps, "ENDOR_API_CREDENTIALS_SECRET", ["Run Codex security worker"]);
    expect(jobEnv).not.toHaveProperty("ENDOR_API_CREDENTIALS_KEY");
    expect(jobEnv).not.toHaveProperty("ENDOR_API_CREDENTIALS_SECRET");
    expectSecretStepAllowlist(steps, "VT_API_KEY", []);
    expect(scanStep?.env ?? {}).not.toHaveProperty("CODEX_API_KEY");
    expect(scanStep?.env ?? {}).not.toHaveProperty("OPENAI_API_KEY");
    expect(scanStep?.env ?? {}).not.toHaveProperty("SECURITY_SCAN_WORKER_TOKEN");
    expect(scanStep?.env ?? {}).not.toHaveProperty("VIRUSTOTAL_API_KEY");
    expect(uploadStep?.env ?? {}).not.toHaveProperty("VIRUSTOTAL_API_KEY");
    expect(steps.find((step) => step.name === "Check configuration")).toBeUndefined();
    const codexInstall = steps.find((step) => step.name === "Install Codex CLI")?.run;
    const clawScanInstall = steps.find((step) => step.name === "Install ClawScan CLI")?.run;
    const aigInstall = steps.find((step) => step.name === "Install A.I.G scanner")?.run;
    const skillspectorInstall = steps.find((step) => step.name === "Install SkillSpector")?.run;
    expect(codexInstall).toContain("npm install -g @openai/codex@0.142.3");
    expect(codexInstall).not.toContain("@latest");
    expect(jobEnv.CODEX_SECURITY_SCAN_CLAWSCAN_VERSION).toBe(
      "${{ vars.CODEX_SECURITY_SCAN_CLAWSCAN_VERSION || '0.2.0' }}",
    );
    expect(clawScanInstall).toContain(
      'npm install -g "@openclaw/clawscan@$CODEX_SECURITY_SCAN_CLAWSCAN_VERSION"',
    );
    expect(clawScanInstall).not.toContain("@latest");
    const endorPrepare = steps.find((step) => step.name === "Prepare Endor scanner");
    expect(endorPrepare?.if).toBe(
      "${{ inputs.environment != 'Staging' && env.CODEX_SECURITY_SCAN_ENDOR_ENABLED == '1' }}",
    );
    expect(endorPrepare?.run).toContain("test -x /usr/local/bin/clawhub-endor-scan");
    expect(endorPrepare?.run).toContain("@sha256:[a-f0-9]{64}$");
    expect(endorPrepare?.run).toContain('docker pull "$CODEX_SECURITY_SCAN_ENDOR_IMAGE"');
    expect(aigInstall).toContain(
      "python -m pip install --require-hashes -r scripts/security/aig-worker-requirements.txt",
    );
    expect(aigInstall).not.toContain("pip install 'aig-skill-scan==0.2.1'");
    expect(aigInstall).not.toContain('version("aig-skill-scan") == "0.2.1"');
    expect(aigInstall).toContain('version("aig-skill-scan") == "0.2.2"');
    expect(aigInstall).not.toContain("aig-skill-scan-0.2.1-gpt5.patch");
    expect(aigInstall).not.toContain("f18ae642d62be142192d6bd4c21c4ea7e098bbc8");
    expect(aigInstall).toContain('assert "temperature=" not in inspect.getsource(LLM.chat_stream)');
    expect(aigInstall).toContain("aig-skill-scan --help");
    expect(skillspectorInstall).toContain(
      "git+https://github.com/NVIDIA/skillspector.git@69dcdfb74487d361ba4c811d088cfdea2ff3a9dc",
    );
    expect(skillspectorInstall).not.toContain("git+https://github.com/NVIDIA/skillspector.git'");
    expect(steps.find((step) => step.name === "Run Codex security worker")?.env).toEqual({
      CODEX_API_KEY: "${{ secrets.CODEX_API_KEY || secrets.OPENAI_API_KEY }}",
      DEFAULT_BASE_URL: "https://api.openai.com/v1",
      DEFAULT_MODEL: "gpt-5.6",
      LLM_API_KEY: "${{ secrets.OPENAI_API_KEY || secrets.CODEX_API_KEY }}",
      OPENAI_API_KEY: "${{ secrets.OPENAI_API_KEY }}",
      SECURITY_SCAN_WORKER_TOKEN:
        "${{ steps.staging-auth.outputs.token || secrets.SECURITY_SCAN_WORKER_TOKEN }}",
      ENDOR_NAMESPACE: "${{ vars.ENDOR_NAMESPACE }}",
      ENDOR_API: "${{ vars.ENDOR_API }}",
      ENDOR_API_CREDENTIALS_KEY: "${{ secrets.ENDOR_API_CREDENTIALS_KEY }}",
      ENDOR_API_CREDENTIALS_SECRET: "${{ secrets.ENDOR_API_CREDENTIALS_SECRET }}",
    });
  });

  it("rejects unsafe Staging targets before setup or deployment access", async () => {
    const workflow = parseYaml(
      await readFile(".github/workflows/security-scan-codex.yml", "utf8"),
    ) as {
      jobs: Record<string, { steps: WorkflowStep[] }>;
    };
    const steps = workflow.jobs["codex-security-scan"].steps;
    const guard = steps.find((step) => step.id === "staging-target");
    expect(steps.indexOf(guard!)).toBeLessThan(
      steps.findIndex((step) => step.uses === "./.github/actions/setup-bun"),
    );
    expect(guard?.if).toBe("inputs.environment == 'Staging'");
    const target = {
      SELECTED_REF: "refs/heads/staging",
      EXPECTED_SHA: "a".repeat(40),
      SELECTED_SHA: "a".repeat(40),
      CONVEX_URL: "https://cheery-civet-733.convex.cloud",
      CONVEX_DEPLOY_KEY: "prod:cheery-civet-733|fixture-only",
      CODEX_SECURITY_SCAN_SHARED_WORKERS: "9",
      CODEX_SECURITY_SCAN_MAX_JOBS: "3",
    };
    const run = (overrides: Partial<typeof target>) =>
      spawnSync("bash", ["-c", guard?.run ?? ""], {
        env: { ...process.env, ...target, ...overrides },
      });
    expect(run({}).status).toBe(0);
    for (const rejected of [
      { SELECTED_REF: "refs/heads/unapproved" },
      { SELECTED_REF: "refs/heads/main" },
      { SELECTED_REF: "refs/heads/jesse/endor-plugin-scan-pipeline" },
      { CONVEX_URL: "https://academic-chihuahua-392.convex.cloud" },
      { CONVEX_DEPLOY_KEY: "prod:academic-chihuahua-392|fixture-only" },
      { EXPECTED_SHA: "b".repeat(40) },
      { EXPECTED_SHA: "" },
      { CONVEX_URL: "https://wry-manatee-359.convex.cloud" },
      { CONVEX_DEPLOY_KEY: "prod:wry-manatee-359|fixture-only" },
      { CODEX_SECURITY_SCAN_SHARED_WORKERS: "18" },
      { CODEX_SECURITY_SCAN_MAX_JOBS: "" },
      { CODEX_SECURITY_SCAN_MAX_JOBS: "100" },
    ])
      expect(run(rejected).status, JSON.stringify(rejected)).not.toBe(0);
  });

  it("bounds Staging assignments and preserves the existing worker credential", async () => {
    const workflow = parseYaml(
      await readFile(".github/workflows/security-scan-codex.yml", "utf8"),
    ) as {
      jobs: Record<string, { steps: WorkflowStep[] }>;
    };
    const steps = workflow.jobs["codex-security-scan"].steps;
    const prepare = steps.find((step) => step.id === "staging-auth");
    const root = await mkdtemp(join(tmpdir(), "endor-staging-auth-"));
    try {
      const state = join(root, "backend-token");
      const output = join(root, "output");
      const bunx = join(root, "bunx");
      await writeFile(
        bunx,
        `#!/usr/bin/env bash
set -euo pipefail
case "$3:$4" in
  securityScan:getJobTargetInternal:*) printf '%s\\n' "$TEST_JOB_TARGET" ;;
  get:APP_BUILD_SHA) printf '%s\\n' "$TEST_DEPLOYED_SHA" ;;
  get:SECURITY_SCAN_WORKER_TOKEN) if [[ -f "$TEST_TOKEN_STATE" ]]; then cat "$TEST_TOKEN_STATE"; printf '\\n'; fi ;;
  *) exit 99 ;;
esac
`,
      );
      await chmod(bunx, 0o755);
      const assignments = (count: number, otherShard = false) => {
        const shards: string[][] = Array.from({ length: 9 }, () => []);
        shards[0] = Array.from({ length: count }, (_, n) => `job-${n}`);
        if (otherShard) shards[8] = ["other-shard-job"];
        return JSON.stringify(shards);
      };
      const queuedJob = {
        targetKind: "packageRelease",
        status: "queued",
        source: "bulk-rescan",
        nextRunAt: 0,
      };
      const env = {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        RUNNER_TEMP: root,
        GITHUB_SHA: "a".repeat(40),
        CODEX_SECURITY_SCAN_WORKER_ID: "fixture-worker",
        GITHUB_OUTPUT: output,
        TEST_DEPLOYED_SHA: "a".repeat(40),
        TEST_TOKEN_STATE: state,
        TEST_JOB_TARGET: JSON.stringify({
          job: queuedJob,
          release: {},
          package: { family: "code-plugin" },
        }),
        CODEX_SECURITY_SCAN_ASSIGNED_JOBS: assignments(3),
      };
      const run = (script: string | undefined, overrides: NodeJS.ProcessEnv = {}) =>
        spawnSync("bash", ["-c", script ?? ""], {
          env: { ...env, ...overrides },
          encoding: "utf8",
        });
      await writeFile(state, "shared-fixture-token");
      const unclaimableJobs = [
        { ...queuedJob, source: "publish" },
        { ...queuedJob, status: "succeeded" },
        { ...queuedJob, status: "running" },
        { ...queuedJob, nextRunAt: Date.now() + 60_000 },
      ].map((job) => ({
        TEST_JOB_TARGET: JSON.stringify({ job, release: {}, package: { family: "code-plugin" } }),
      }));
      for (const invalid of [
        ...unclaimableJobs,
        { CODEX_SECURITY_SCAN_ASSIGNED_JOBS: assignments(0) },
        { CODEX_SECURITY_SCAN_ASSIGNED_JOBS: assignments(4) },
        { CODEX_SECURITY_SCAN_ASSIGNED_JOBS: assignments(1, true) },
        { TEST_DEPLOYED_SHA: "b".repeat(40) },
        { TEST_JOB_TARGET: JSON.stringify({ job: { targetKind: "skillVersion" } }) },
        {
          TEST_JOB_TARGET: JSON.stringify({
            job: { targetKind: "packageRelease" },
            release: {},
            package: { family: "skill" },
          }),
        },
      ]) {
        expect(run(prepare?.run, invalid).status, JSON.stringify(invalid)).not.toBe(0);
        expect(await readFile(state, "utf8")).toBe("shared-fixture-token");
        await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
      }
      for (const { count, family } of [
        { count: 1, family: "bundle-plugin" },
        { count: 3, family: "code-plugin" },
      ]) {
        const result = run(prepare?.run, {
          CODEX_SECURITY_SCAN_ASSIGNED_JOBS: assignments(count),
          TEST_JOB_TARGET: JSON.stringify({
            job: queuedJob,
            release: {},
            package: { family },
          }),
        });
        expect(result.status, result.stderr).toBe(0);
        expect(await readFile(state, "utf8")).toBe("shared-fixture-token");
        expect(await readFile(output, "utf8")).toBe("token=shared-fixture-token\n");
        expect(result.stdout).toContain("::add-mask::shared-fixture-token");
        await rm(output);
      }
      const verify = steps.find((step) => step.name === "Verify Staging scan results");
      expect(verify?.if).toBe("inputs.environment == 'Staging'");
      expect(steps.indexOf(verify!)).toBeGreaterThan(
        steps.findIndex((step) => step.name === "Run Codex security worker"),
      );
      const completed = {
        job: { ...queuedJob, status: "succeeded", workerId: "fixture-worker" },
        release: {
          version: "1.0.0",
          endorAnalysis: { status: "completed", reachableFunctionCount: 0 },
          llmAnalysis: { checkedAt: 1, verdict: "benign" },
        },
        package: { name: "trial-plugin", family: "code-plugin" },
      };
      const stored = (target: unknown) => ({ TEST_JOB_TARGET: JSON.stringify(target) });
      const verified = run(verify?.run, stored(completed));
      expect(verified.status, verified.stderr).toBe(0);
      expect(verified.stdout.match(/trial-plugin/g)).toHaveLength(3);
      for (const target of [
        { ...completed, job: { ...completed.job, status: "queued" } },
        { ...completed, job: { ...completed.job, workerId: "previous-worker" } },
        { ...completed, job: { ...completed.job, leaseToken: "active-lease" } },
        { ...completed, release: { ...completed.release, endorAnalysis: { status: "failed" } } },
        { ...completed, release: { ...completed.release, endorAnalysis: { status: "skipped" } } },
        { ...completed, release: { ...completed.release, llmAnalysis: undefined } },
      ])
        expect(run(verify?.run, stored(target)).status, JSON.stringify(target)).not.toBe(0);
      await rm(state);
      expect(run(prepare?.run).status).not.toBe(0);
      await expect(readFile(state)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
