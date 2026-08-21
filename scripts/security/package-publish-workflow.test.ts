/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

type WorkflowStep = {
  env?: Record<string, unknown>;
  id?: string;
  name?: string;
  run?: string;
};

describe("package publish reusable workflow", () => {
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
    });
    expect(validateStep?.run).toContain(
      "publication_timeout_minutes must be an integer from 1 through 40",
    );
    expect(validateStep?.run).toContain("PUBLICATION_TIMEOUT_MINUTES > 40");

    const resolveStep = job.steps.find((step) => step.name === "Resolve publish command");
    expect(resolveStep?.env).toMatchObject({
      INPUT_WAIT_FOR_PUBLICATION: "${{ inputs.wait_for_publication }}",
      INPUT_PUBLICATION_TIMEOUT_MINUTES: "${{ inputs.publication_timeout_minutes }}",
    });
    expect(resolveStep?.run).toContain('cmd += ["--wait", "--wait-timeout"');
    expect(resolveStep?.run).toContain("timeout_minutes * 60");

    const captureStep = job.steps.find((step) => step.name === "Capture workflow outputs");
    expect(captureStep?.env).toMatchObject({
      DRY_RUN: "${{ inputs.dry_run }}",
      WAIT_FOR_PUBLICATION: "${{ inputs.wait_for_publication }}",
    });
    expect(captureStep?.run).toContain('parsed.get("publicationStatus") != "published"');

    const verifyIndex = job.steps.findIndex(
      (step) => step.name === "Revalidate trusted tooling identity",
    );
    const publishIndex = job.steps.findIndex((step) => step.name === "Run package publish");
    const verifyStep = job.steps[verifyIndex];
    expect(verifyIndex + 1).toBe(publishIndex);
    expect(verifyStep?.env).toMatchObject({
      GH_TOKEN: "${{ github.token }}",
      TRUSTED_TOOLING_IDENTITY_JSON: "${{ inputs.trusted_tooling_identity_json }}",
      GITHUB_REPOSITORY: "${{ github.repository }}",
      GITHUB_RUN_ID: "${{ github.run_id }}",
      GITHUB_RUN_ATTEMPT: "${{ github.run_attempt }}",
      GITHUB_WORKFLOW_REF: "${{ github.workflow_ref }}",
      GITHUB_WORKFLOW_SHA: "${{ github.workflow_sha }}",
      GITHUB_EVENT_NAME: "${{ github.event_name }}",
    });
    expect(verifyStep?.run).toContain("verify-trusted-tooling-identity.cjs");
  });
});
