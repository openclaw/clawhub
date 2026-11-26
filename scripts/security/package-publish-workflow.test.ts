/* @vitest-environment node */
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  "continue-on-error"?: boolean;
  "working-directory"?: string;
  env?: Record<string, unknown>;
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

describe("package publish reusable workflow", () => {
  it.each([false, true])(
    "retains checkout cleanup metadata when relocation fails=%s",
    async (failMove) => {
      const workflow = parseYaml(await readFile(".github/workflows/package-publish.yml", "utf8"));
      const steps = workflow.jobs.publish.steps as WorkflowStep[];
      const moveIndex = steps.findIndex(
        (step) => step.name === "Move ClawHub source out of the caller workspace",
      );
      const installIndex = steps.findIndex(
        (step) => step.name === "Install ClawHub CLI dependencies",
      );
      expect(moveIndex).toBeGreaterThan(-1);
      expect(moveIndex).toBeLessThan(installIndex);
      expect(steps[installIndex]?.["working-directory"]).toBe("${{ runner.temp }}/clawhub-source");
      const move = steps[moveIndex]?.run;
      if (!move) throw new Error("Missing tooling relocation step");
      const root = await mkdtemp(join(tmpdir(), "package-workflow-"));
      try {
        const workspace = join(root, "workspace");
        const runnerTemp = join(root, "runner-temp");
        const checkout = join(workspace, "clawhub-source");
        const bin = join(root, "bin");
        await mkdir(checkout, { recursive: true });
        await mkdir(runnerTemp);
        await mkdir(bin);
        const git = (args: string[]) => spawnSync("git", args, { cwd: checkout, encoding: "utf8" });
        expect(git(["-c", "init.templateDir=", "init", "--quiet"]).status).toBe(0);
        expect(git(["config", "--local", "clawhub.fixture", "preserved"]).status).toBe(0);
        const config = await readFile(join(checkout, ".git", "config"));
        await writeFile(join(checkout, "tooling.txt"), "tooling\n");
        await writeFile(join(checkout, ".hidden"), "hidden\n");
        if (failMove) {
          await writeFile(join(bin, "mv"), "#!/bin/sh\nexit 42\n");
          await chmod(join(bin, "mv"), 0o755);
        }
        const result = spawnSync("bash", ["-e", "-c", move], {
          cwd: workspace,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            GITHUB_WORKSPACE: workspace,
            RUNNER_TEMP: runnerTemp,
          },
        });
        expect(result.status).toBe(failMove ? 42 : 0);
        expect(await readFile(join(checkout, ".git", "config"))).toEqual(config);
        expect(git(["config", "--local", "--get", "clawhub.fixture"]).stdout.trim()).toBe(
          "preserved",
        );
        if (!failMove) {
          expect(await readdir(checkout)).toEqual([".git"]);
          expect((await readdir(join(runnerTemp, "clawhub-source"))).sort()).toEqual([
            ".hidden",
            "tooling.txt",
          ]);
          expect(await readFile(join(runnerTemp, "clawhub-source", "tooling.txt"), "utf8")).toBe(
            "tooling\n",
          );
          expect(await readFile(join(runnerTemp, "clawhub-source", ".hidden"), "utf8")).toBe(
            "hidden\n",
          );
        } else {
          expect(await readFile(join(checkout, "tooling.txt"), "utf8")).toBe("tooling\n");
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("waits for definitive publication by default", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/package-publish.yml", "utf8")) as {
      jobs: {
        publish: {
          steps: WorkflowStep[];
          "timeout-minutes"?: number;
        };
      };
      on?: {
        workflow_call?: {
          inputs?: Record<
            string,
            {
              default?: boolean | number | string;
              type?: string;
            }
          >;
        };
      };
    };

    expect(workflow.on?.workflow_call?.inputs?.wait_for_publication).toMatchObject({
      type: "boolean",
      default: true,
    });
    expect(workflow.on?.workflow_call?.inputs?.publication_timeout_minutes).toMatchObject({
      type: "number",
      default: 30,
    });
    expect(workflow.on?.workflow_call?.inputs?.trusted_tooling_identity_json).toMatchObject({
      type: "string",
      default: "",
    });

    const job = workflow.jobs.publish;
    expect(job["timeout-minutes"]).toBe(75);

    const validateStep = job.steps.find((step) => step.name === "Validate publish mode inputs");
    expect(validateStep?.env).toMatchObject({
      WAIT_FOR_PUBLICATION: "${{ inputs.wait_for_publication }}",
      PUBLICATION_TIMEOUT_MINUTES: "${{ inputs.publication_timeout_minutes }}",
      GITHUB_REPOSITORY: "${{ github.repository }}",
      GITHUB_ACTOR: "${{ github.actor }}",
      GITHUB_ACTOR_TYPE: "${{ github.event.sender.type }}",
      TRUSTED_TOOLING_IDENTITY_JSON: "${{ inputs.trusted_tooling_identity_json }}",
    });
    expect(validateStep?.run).toContain(
      "publication_timeout_minutes must be an integer from 1 through 40",
    );
    expect(validateStep?.run).toContain("PUBLICATION_TIMEOUT_MINUTES > 40");
    expect(validateStep?.run).toContain(
      "Automated OpenClaw real publishes require trusted tooling identity v2.",
    );
    expect(validateStep?.run).toContain('"$actor_type" == "app"');

    const resolveStep = job.steps.find((step) => step.name === "Resolve publish command");
    expect(resolveStep?.env).toMatchObject({
      INPUT_WAIT_FOR_PUBLICATION: "${{ inputs.wait_for_publication }}",
      INPUT_PUBLICATION_TIMEOUT_MINUTES: "${{ inputs.publication_timeout_minutes }}",
      TRUSTED_TOOLING_IDENTITY_JSON: "${{ inputs.trusted_tooling_identity_json }}",
    });
    expect(resolveStep?.run).toContain('cmd += ["--wait", "--wait-timeout"');
    expect(resolveStep?.run).toContain("timeout_minutes * 60");
    expect(resolveStep?.run).toContain(
      'os.environ["INPUT_WAIT_FOR_PUBLICATION"] == "true" and not is_openclaw_v2',
    );
    expect(resolveStep?.run).toContain('trusted_identity.get("repository") == "openclaw/openclaw"');

    const captureStep = job.steps.find((step) => step.name === "Capture workflow outputs");
    expect(captureStep?.env).toMatchObject({
      DRY_RUN: "${{ inputs.dry_run }}",
      WAIT_FOR_PUBLICATION: "${{ inputs.wait_for_publication }}",
      TRUSTED_TOOLING_IDENTITY_JSON: "${{ inputs.trusted_tooling_identity_json }}",
    });
    expect(captureStep?.run).toContain('parsed.get("publicationStatus") != "published"');
    expect(captureStep?.run).toContain("and not is_openclaw_v2");
    expect(captureStep?.run).toContain('trusted_identity.get("repository") == "openclaw/openclaw"');

    const verifyIndex = job.steps.findIndex(
      (step) => step.name === "Revalidate trusted tooling identity",
    );
    const parentReceiptIndex = job.steps.findIndex(
      (step) => step.name === "Download release parent authorization receipt",
    );
    const recoveryReceiptIndex = job.steps.findIndex(
      (step) => step.name === "Download recovery environment approval receipt",
    );
    const resolveIndex = job.steps.findIndex(
      (step) => step.name === "Resolve release parent authorization artifact",
    );
    const publishIndex = job.steps.findIndex((step) => step.name === "Run package publish");
    const publishStep = job.steps[publishIndex];
    const verifyStep = job.steps[verifyIndex];
    const parentReceiptStep = job.steps[parentReceiptIndex];
    const recoveryReceiptStep = job.steps[recoveryReceiptIndex];
    expect(parentReceiptIndex).toBeGreaterThan(-1);
    expect(recoveryReceiptIndex).toBeGreaterThan(-1);
    expect(resolveIndex).toBe(recoveryReceiptIndex + 1);
    expect(parentReceiptIndex).toBe(resolveIndex + 1);
    expect(verifyIndex).toBe(parentReceiptIndex + 1);
    expect(verifyIndex + 1).toBe(publishIndex);
    expect(parentReceiptStep).toMatchObject({
      if: "inputs.trusted_tooling_identity_json != ''",
      uses: "actions/download-artifact@v8",
      with: {
        "github-token": "${{ github.token }}",
        repository: "${{ fromJson(inputs.trusted_tooling_identity_json).parentRepository }}",
        "run-id": "${{ fromJson(inputs.trusted_tooling_identity_json).parentRunId }}",
      },
    });
    expect(parentReceiptStep?.with?.name).toBe(
      "${{ steps.parent_authorization.outputs.artifact_name }}",
    );
    expect(job.steps[resolveIndex]?.run).toContain("parentArtifactName(identity, child)");
    expect(job.steps[resolveIndex]?.run).toContain("parseRecoveryApprovalReceipt");
    expect(recoveryReceiptStep).toMatchObject({
      id: "recovery_approval",
      if: "inputs.trusted_tooling_identity_json != ''",
      "continue-on-error": true,
      uses: "actions/download-artifact@v8",
      with: {
        name: "openclaw-clawhub-recovery-approval-${{ github.run_id }}-${{ github.run_attempt }}",
        "github-token": "${{ github.token }}",
        repository: "${{ github.repository }}",
        "run-id": "${{ github.run_id }}",
      },
    });
    expect(verifyStep?.env).toMatchObject({
      GH_TOKEN: "${{ github.token }}",
      TRUSTED_TOOLING_IDENTITY_JSON: "${{ inputs.trusted_tooling_identity_json }}",
      PARENT_AUTHORIZATION_RECEIPT_PATH:
        "${{ runner.temp }}/openclaw-clawhub-parent-authorization/authorization.json",
      RECOVERY_APPROVAL_RECEIPT_PATH:
        "${{ steps.recovery_approval.outcome == 'success' && format('{0}/openclaw-clawhub-recovery-approval/approval.json', runner.temp) || '' }}",
      GITHUB_REPOSITORY: "${{ github.repository }}",
      GITHUB_RUN_ID: "${{ github.run_id }}",
      GITHUB_RUN_ATTEMPT: "${{ github.run_attempt }}",
      GITHUB_WORKFLOW_REF: "${{ github.workflow_ref }}",
      GITHUB_WORKFLOW_SHA: "${{ github.workflow_sha }}",
      GITHUB_EVENT_NAME: "${{ github.event_name }}",
      GITHUB_ACTOR: "${{ github.actor }}",
    });
    expect(verifyStep?.run).toContain("verify-trusted-tooling-identity.cjs");
    expect(publishStep?.env).toMatchObject({
      GH_TOKEN: "${{ github.token }}",
      TRUSTED_TOOLING_IDENTITY_JSON: "${{ inputs.trusted_tooling_identity_json }}",
      PARENT_AUTHORIZATION_RECEIPT_PATH:
        "${{ runner.temp }}/openclaw-clawhub-parent-authorization/authorization.json",
      RECOVERY_APPROVAL_RECEIPT_PATH:
        "${{ steps.recovery_approval.outcome == 'success' && format('{0}/openclaw-clawhub-recovery-approval/approval.json', runner.temp) || '' }}",
      GITHUB_ACTOR: "${{ github.actor }}",
    });
  });
});
