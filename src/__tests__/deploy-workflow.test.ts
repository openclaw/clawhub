import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

describe("production deploy workflow", () => {
  type WorkflowStep = {
    name?: string;
    env?: Record<string, string>;
    if?: string;
    run?: string;
  };

  type WorkflowJob = {
    env?: Record<string, string>;
    needs?: string | string[];
    permissions?: Record<string, string>;
    steps?: WorkflowStep[];
  };

  it("queues active deploys instead of cancelling them", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/deploy.yml", "utf8")) as {
      concurrency?: {
        group?: string;
        "cancel-in-progress"?: boolean;
      };
    };

    expect(workflow.concurrency).toEqual({
      group: "deploy-production",
      "cancel-in-progress": false,
    });
  });

  it("scopes production secrets and write permissions to the steps that need them", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/deploy.yml", "utf8")) as {
      permissions?: Record<string, string>;
      jobs?: Record<string, WorkflowJob>;
    };
    const deployJob = workflow.jobs?.["deploy-production"];
    const tagJob = workflow.jobs?.["tag-production-deployment"];
    const convexSecretSteps =
      deployJob?.steps?.filter((step) => step.env?.CONVEX_DEPLOY_KEY).map((step) => step.name) ??
      [];
    const authSecretSteps =
      deployJob?.steps
        ?.filter((step) => step.env?.PLAYWRIGHT_AUTH_STORAGE_STATE_JSON)
        .map((step) => step.name) ?? [];

    expect(workflow.permissions).toEqual({});
    expect(deployJob?.permissions).toEqual({ contents: "read", statuses: "read" });
    expect(deployJob?.env).toEqual({ PLAYWRIGHT_BASE_URL: "https://clawhub.ai" });
    expect(convexSecretSteps).toEqual([
      "Check deploy configuration",
      "Stamp Convex build SHA",
      "Stamp Convex deploy time",
      "Deploy Convex",
      "Publish promotions feed snapshot",
      "Verify Convex contract",
    ]);
    expect(authSecretSteps).toEqual(["Write authenticated storage state"]);
    expect(tagJob?.permissions).toEqual({ contents: "write" });
    expect(tagJob?.needs).toEqual(["validate-deploy-request", "deploy-production"]);
  });

  it("publishes the initial promotions snapshot after backend deploy", async () => {
    const workflow = parseYaml(await readFile(".github/workflows/deploy.yml", "utf8")) as {
      jobs?: Record<string, WorkflowJob>;
    };
    const steps = workflow.jobs?.["deploy-production"]?.steps ?? [];
    const deployIndex = steps.findIndex((step) => step.name === "Deploy Convex");
    const publishIndex = steps.findIndex(
      (step) => step.name === "Publish promotions feed snapshot",
    );
    const verifyIndex = steps.findIndex((step) => step.name === "Verify Convex contract");
    const publishStep = steps[publishIndex];

    expect(deployIndex).toBeGreaterThanOrEqual(0);
    expect(publishIndex).toBeGreaterThan(deployIndex);
    expect(verifyIndex).toBeGreaterThan(publishIndex);
    expect(publishStep?.if).toBe("needs.validate-deploy-request.outputs.deploy_backend == 'true'");
    expect(publishStep?.run).toBe("bunx convex run promotionsFeed:publishInternal --prod");
  });
});
