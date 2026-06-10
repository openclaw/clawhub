import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

describe("package publish workflow", () => {
  it("runs plugin-inspector before publishing and uploads inspector artifacts", () => {
    const workflow = readFileSync(resolve(".github/workflows/package-publish.yml"), "utf8");

    const inspectorIndex = workflow.indexOf("Run plugin validation");
    const publishIndex = workflow.indexOf("Run package publish");
    const checkoutPublishSourceIndex = workflow.indexOf(
      "Checkout publish source for plugin inspector",
    );

    expect(inspectorIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(-1);
    expect(checkoutPublishSourceIndex).toBeGreaterThan(-1);
    expect(checkoutPublishSourceIndex).toBeLessThan(inspectorIndex);
    expect(inspectorIndex).toBeLessThan(publishIndex);
    expect(workflow).toContain("inspect_checkout_repository");
    expect(workflow).toContain("clawhub-publish-source");
    expect(workflow).toContain("INSPECT_LOCAL_ROOT");
    expect(workflow).toContain("source_ref_differs_from_checkout");
    expect(workflow).toContain("resolve_github_url_ref_and_path");
    expect(workflow).toContain("quote(ref, safe='')");
    expect(workflow).toContain("error.code in (404, 422)");
    expect(workflow).toContain("package validate");
    expect(workflow).not.toContain('config_path = root / ".plugin-inspector.json"');
    expect(workflow).not.toContain("generated_config_path.write_text(str(config_path)");
    expect(workflow).not.toContain("cleanup_generated_inspector_config");
    expect(workflow).toContain("plugin-inspector-report");
    expect(workflow).toContain("actions/upload-artifact");
  });

  it("runs manual plugin inspector bulk scans with the bundled CLI validator", () => {
    const workflow = readFileSync(
      resolve(".github/workflows/plugin-inspector-nightly.yml"),
      "utf8",
    );
    const script = readFileSync(resolve("scripts/package-inspector-nightly-scan.ts"), "utf8");
    const http = readFileSync(resolve("convex/packageInspectorHttp.ts"), "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("Maximum plugin releases to scan");
    expect(workflow).toContain("Plugin Inspector Bulk Scan");
    expect(workflow).toContain("plugin-inspector-bulk-scan-reports");
    expect(workflow).toContain("source_pr:");
    expect(workflow).toContain("source_sha:");
    expect(workflow).not.toMatch(/^\s*schedule:/m);
    expect(workflow).not.toMatch(/^\s*-\s*cron:/m);
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN");
    expect(script).toContain("package-inspector/claim");
    expect(script).toContain('"package", "validate"');
    expect(script).toContain("resolveBundledPluginInspectorVersion");
    expect(http).toContain("package-inspector/artifact");
    expect(script).toContain("package-inspector/results");
    expect(script).toContain("Authorization: `Bearer ${token}`");
    expect(script).toContain('path.join(pluginRoot, "package")');
    expect(script).not.toContain("plugin-inspector-nightly-error");
    expect(script).toContain("pluginInspector");
    expect(workflow).toContain("dry_run:");
    expect(workflow).toContain("PLUGIN_INSPECTOR_DRY_RUN");
    expect(workflow).toContain("PLUGIN_INSPECTOR_DRY_RUN_MAX_BATCHES");
    expect(script).toContain("const dryRun =");
    expect(script).toContain('dryRun ? "true" : "false"');
    expect(script).toContain("impact-summary.json");
    expect(script).toContain("summarizeImpact");
    expect(script).toContain("if (!dryRun) {");
    expect(workflow).toContain("actions/upload-artifact");
  });

  it("dispatches plugin inspector bulk scans after merged inspector pin bumps", () => {
    const workflowText = readFileSync(
      resolve(".github/workflows/plugin-inspector-pin-bump-dispatch.yml"),
      "utf8",
    );
    const workflow = parseYaml(workflowText) as {
      on?: {
        pull_request_target?: {
          branches?: string[];
          types?: string[];
          paths?: string[];
        };
      };
      permissions?: Record<string, string>;
      jobs?: Record<
        string,
        {
          if?: string;
          steps?: Array<{ name?: string; run?: string; with?: Record<string, string> }>;
        }
      >;
    };

    expect(workflow.on?.pull_request_target?.branches).toEqual(["main"]);
    expect(workflow.on?.pull_request_target?.types).toEqual(["closed"]);
    expect(workflow.on?.pull_request_target?.paths).toEqual(["package.json", "bun.lock"]);
    expect(workflow.permissions?.actions).toBe("write");

    const job = workflow.jobs?.["dispatch-plugin-inspector-bulk-scan"];
    expect(job?.if).toContain("github.event.pull_request.merged == true");
    expect(workflowText).toContain("scripts/github/plugin-inspector-pin-change.mjs");
    expect(workflowText).toContain("gh workflow run plugin-inspector-nightly.yml");
    expect(workflowText).toContain("--ref main");
    expect(workflowText).toContain("batch_size=25");
    expect(workflowText).toContain("dry_run=false");
    expect(workflowText).toContain("source_pr=${{ github.event.pull_request.number }}");
    expect(workflowText).toContain("source_sha=${{ github.event.pull_request.merge_commit_sha");
  });

  it("supports publishing a prebuilt ClawPack artifact from a caller workflow", () => {
    const workflow = readFileSync(resolve(".github/workflows/package-publish.yml"), "utf8");

    expect(workflow).toContain("package_artifact_name:");
    expect(workflow).toContain("package_artifact_path:");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("Download prebuilt package artifact");
    expect(workflow).toContain("actions/download-artifact");
    expect(workflow).toContain("Resolve prebuilt package artifact");
    expect(workflow).toContain("Extract prebuilt package artifact for plugin validation");
    expect(workflow).toContain("INPUT_PACKAGE_ARTIFACT_PATH");
    expect(workflow).toContain("package_artifact_path=");
    expect(workflow).toContain("PREBUILT_PACKAGE_ARTIFACT_PATH");
    expect(workflow).toContain("tar -xzf");
    expect(workflow).toContain("cmd_source = prebuilt_artifact_path or source");
    expect(workflow).toContain("if source_path and prebuilt_artifact_path:");
    expect(workflow).toContain("if prebuilt_artifact_path:");
    expect(workflow).toContain("if not source_repo and not source_commit:");
    expect(workflow).toContain('source_repo = os.environ["GITHUB_REPOSITORY"].strip()');
    expect(workflow).toContain('source_commit = os.environ["GITHUB_SHA"].strip()');
    expect(workflow).toContain(
      "Prebuilt artifact mode requires source_repo and source_commit together",
    );
    expect(workflow).toContain("Prebuilt artifact mode does not accept source_path");
  });
});
