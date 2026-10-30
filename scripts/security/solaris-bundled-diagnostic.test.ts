/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { projectBundledRuntimeErrors } from "./clawscan-diagnostic-skillspector";
import original from "./fixtures/solaris-069-bundled.json";
import { assertSolarisDiagnosticAdmission } from "./solaris-bundled-diagnostic";

const admission = {
  platform: "linux",
  GITHUB_ACTIONS: "true",
  RUNNER_OS: "Linux",
  RUNNER_ARCH: "X64",
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  CLAWSCAN_DIAGNOSTIC_RUNNER: "ubuntu-22.04",
  RUNNER_ENVIRONMENT: "github-hosted",
  RUNNER_TEMP: "/tmp/runner",
  GITHUB_WORKSPACE: "/tmp/workspace",
};

it("binds all original bytes and the exact sorted bundled-root list", () => {
  expect(original.files).toHaveLength(1335);
  expect(original.files.reduce((sum, file) => sum + file.size, 0)).toBe(15006503);
  expect(original.bundledRoots).toHaveLength(62);
  expect(original.bundledRoots).toEqual([...new Set(original.bundledRoots)].sort());
  for (const root of original.bundledRoots)
    expect(original.files.some((file) => file.path === `${root}/SKILL.md`)).toBe(true);
});

it("admits only the fixed hosted main-branch manual route", () => {
  expect(() => assertSolarisDiagnosticAdmission(admission, [])).not.toThrow();
  for (const key of Object.keys(admission)) {
    expect(() => assertSolarisDiagnosticAdmission({ ...admission, [key]: "" }, [])).toThrow();
  }
  for (const args of [
    ["--fixture", "other"],
    ["--source", "latest"],
    ["--url", "PRIVATE"],
  ])
    expect(() => assertSolarisDiagnosticAdmission(admission, args)).toThrow();
});

it("projects structured runtime errors without exporting arbitrary classes, paths or messages", () => {
  const result = projectBundledRuntimeErrors({
    analysis_completeness: {
      ledger_exceptions: [
        {
          reason_code: "analyzer_runtime_error",
          error_class: "RateLimitError",
          path: "PRIVATE",
          message: "PRIVATE",
        },
        { reason_code: "analyzer_runtime_error", error_class: "RateLimitError" },
        { reason_code: "analyzer_runtime_error", error_class: "PRIVATE" },
        { reason_code: "llm_batch_failed", error_class: "BadRequestError" },
        { reason_code: "llm_structured_response_invalid", error_class: "ValidationError" },
        { reason_code: "runtime_limit", error_class: "LLMRuntimeLimitError" },
      ],
    },
  });
  expect(result).toEqual({
    classes: { RateLimitError: 2, BadRequestError: 1, ValidationError: 1, LLMRuntimeLimitError: 1 },
    unknownClasses: 1,
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(projectBundledRuntimeErrors(null)).toEqual({ classes: {}, unknownClasses: null });
  expect(
    projectBundledRuntimeErrors({ analysis_completeness: { ledger_exceptions: "PRIVATE" } }),
  ).toEqual({ classes: {}, unknownClasses: null });
});

it("has no dispatch selectors, worker/backend credentials or broad artifact upload", async () => {
  const raw = await readFile(
    new URL("../../.github/workflows/solaris-bundled-diagnostic.yml", import.meta.url),
    "utf8",
  );
  const workflow = parse(raw);
  expect(workflow.on.workflow_dispatch).toBeNull();
  expect(workflow.permissions).toEqual({ contents: "read" });
  const job = workflow.jobs.diagnostic;
  expect(job.environment).toBe("Production");
  expect(job["runs-on"]).toBe("ubuntu-22.04");
  expect(job.if).toContain("github.ref == 'refs/heads/main'");
  const upload = job.steps.find((s: { uses?: string }) =>
    s.uses?.startsWith("actions/upload-artifact@"),
  );
  expect(upload.with.path).toBe("${{ steps.probe.outputs.safe-output }}/summary.json");
  expect(raw).not.toMatch(
    /WORKER_TOKEN|CONVEX|assigned-jobs|workflow_call|pull_request|repository_dispatch/,
  );
});
