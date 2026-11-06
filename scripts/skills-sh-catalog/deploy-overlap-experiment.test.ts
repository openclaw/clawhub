/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  firstExperimentRun,
  isUnstartedCancellation,
  syncEnvironment,
  syncOwnsActiveControl,
  validateExperimentRequest,
} from "./deploy-overlap-experiment";

const request = {
  GITHUB_REPOSITORY: "openclaw/clawhub",
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_ACTOR: "Patrick-Erichsen",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_RUN_ID: "100",
  GITHUB_SHA: "a".repeat(40),
  EXPERIMENT_SHA: "a".repeat(40),
  EXPERIMENT_CONFIRM: "deploy-once-with-enabled-skills-sh",
  EXPERIMENT_CI_RUN: "123",
  EXPERIMENT_TEST_RUN: "456",
  CONVEX_DEPLOY_KEY: "prod:wry-manatee-359|fixture",
};

describe("temporary controlled deployment authority", () => {
  it("excludes only an exact first-attempt cancellation with no jobs", () => {
    const run = { status: "completed", conclusion: "cancelled", run_attempt: 1 };
    const jobs = { total_count: 0, jobs: [] };
    expect(isUnstartedCancellation(run, jobs)).toBe(true);
    expect(isUnstartedCancellation(run, { total_count: 1, jobs: [{}] })).toBe(false);
    expect(isUnstartedCancellation(run, { total_count: 0, jobs: [{}] })).toBe(false);
    expect(isUnstartedCancellation(run, {})).toBe(false);
    expect(isUnstartedCancellation({ ...run, run_attempt: 2 }, jobs)).toBe(false);
    expect(isUnstartedCancellation({ ...run, status: "in_progress" }, jobs)).toBe(false);
    expect(isUnstartedCancellation({ ...run, conclusion: "failure" }, jobs)).toBe(false);
    expect(isUnstartedCancellation({ ...run, conclusion: "success" }, jobs)).toBe(false);
  });
  it("binds new or resumed durable work to this live sync worker, not its original start time", () => {
    const control = { enabled: true, paused: false, updatedBy: "github-actions:100:1" };
    expect(syncOwnsActiveControl(control, request)).toBe(true);
    expect(syncOwnsActiveControl({ ...control, enabled: false }, request)).toBe(false);
    expect(syncOwnsActiveControl({ ...control, paused: true }, request)).toBe(false);
    expect(syncOwnsActiveControl({ ...control, updatedBy: "github-actions:99:1" }, request)).toBe(
      false,
    );
  });
  it("uses durable run identity across fresh dispatches, independent of completion or queue state", () => {
    const title = "2026-10-05 single skills.sh deployment overlap experiment";
    expect(
      firstExperimentRun([
        { id: 300, display_title: title },
        { id: 200, display_title: "skills.sh Production Sync" },
        { id: 100, display_title: title },
      ]),
    ).toBe(100);
    expect(firstExperimentRun([])).toBeUndefined();
  });
  it("retains the sync's OIDC environment without sharing the production deploy credential", () => {
    const env = { ...request, ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-fixture" };
    const child = syncEnvironment(env);
    expect(child.CONVEX_DEPLOY_KEY).toBeUndefined();
    expect(child.ACTIONS_ID_TOKEN_REQUEST_TOKEN).toBe("oidc-fixture");
    expect(env.CONVEX_DEPLOY_KEY).toBe(request.CONVEX_DEPLOY_KEY);
  });
  it("accepts an exact first-attempt Patrick main request", () => {
    expect(() => validateExperimentRequest(request)).not.toThrow();
  });

  it.each([
    ["GITHUB_REPOSITORY", "other/repository"],
    ["GITHUB_REF", "refs/heads/other"],
    ["GITHUB_EVENT_NAME", "schedule"],
    ["GITHUB_ACTOR", "other-maintainer"],
    ["GITHUB_RUN_ATTEMPT", "2"],
    ["GITHUB_RUN_ID", ""],
    ["EXPERIMENT_SHA", "b".repeat(40)],
    ["EXPERIMENT_CONFIRM", ""],
    ["EXPERIMENT_CI_RUN", ""],
    ["EXPERIMENT_TEST_RUN", "not-an-id"],
    ["CONVEX_DEPLOY_KEY", "prod:other-deployment|fixture"],
  ])("rejects an unauthorized %s before any production work", (key, value) => {
    expect(() => validateExperimentRequest({ ...request, [key]: value })).toThrow();
  });
});
