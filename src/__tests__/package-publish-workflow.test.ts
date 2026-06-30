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
    expect(workflow).toContain('delimiter = f"ghadelimiter_{uuid.uuid4().hex}"');
    expect(workflow).toContain('write_output(fh, "inspect_subdir", inspect_subdir)');
    expect(workflow).toContain("package validate");
    expect(workflow).not.toContain('config_path = root / ".plugin-inspector.json"');
    expect(workflow).not.toContain("generated_config_path.write_text(str(config_path)");
    expect(workflow).not.toContain("cleanup_generated_inspector_config");
    expect(workflow).toContain("plugin-inspector-report");
    expect(workflow).toContain("inspector_artifact_name:");
    expect(workflow).toContain("name: ${{ inputs.inspector_artifact_name }}");
    expect(workflow).toContain("actions/upload-artifact");
  });

  it("runs manual plugin inspector bulk scans with the bundled CLI validator", () => {
    const workflow = readFileSync(
      resolve(".github/workflows/plugin-inspector-bulk-scan.yml"),
      "utf8",
    );
    const parsedWorkflow = parseYaml(workflow) as {
      on?: {
        workflow_dispatch?: {
          inputs?: {
            dry_run?: { default?: string };
            package_names?: { default?: string };
          };
        };
      };
    };
    const script = readFileSync(resolve("scripts/package-inspector-nightly-scan.ts"), "utf8");
    const http = readFileSync(resolve("convex/packageInspectorHttp.ts"), "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("Maximum plugin releases to scan");
    expect(workflow).toContain("Plugin Inspector Bulk Scan");
    expect(workflow).toContain("plugin-inspector-bulk-scan-reports");
    expect(workflow).toContain("source_pr:");
    expect(workflow).toContain("source_sha:");
    expect(workflow).toContain(
      "concurrency:\n  group: clawhub-plugin-inspector-bulk-scan\n  cancel-in-progress: false",
    );
    expect(workflow).not.toMatch(/^\s*schedule:/m);
    expect(workflow).not.toMatch(/^\s*-\s*cron:/m);
    expect(workflow).toContain("ref: main");
    expect(workflow).toContain("if: ${{ github.ref == 'refs/heads/main' }}");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN");
    expect(script).toContain("package-inspector/claim");
    expect(script).toContain('"package", "validate"');
    expect(script).toContain("resolveBundledPluginInspectorVersion");
    expect(http).toContain("package-inspector/artifact");
    expect(script).toContain("package-inspector/results");
    expect(script).toContain("Authorization: `Bearer ${token}`");
    expect(script).toContain('path.join(pluginRoot, "package")');
    expect(script).not.toContain("plugin-inspector-bulk-scan-error");
    expect(script).toContain("pluginInspector");
    expect(workflow).toContain("dry_run:");
    expect(parsedWorkflow.on?.workflow_dispatch?.inputs?.dry_run?.default).toBe("true");
    expect(workflow).toContain("PLUGIN_INSPECTOR_DRY_RUN");
    expect(workflow).toContain("PLUGIN_INSPECTOR_DRY_RUN_MAX_BATCHES");
    expect(workflow).toContain("PLUGIN_INSPECTOR_PACKAGE_NAMES");
    expect(parsedWorkflow.on?.workflow_dispatch?.inputs?.package_names?.default).toBe("");
    expect(script).toContain("const dryRun =");
    expect(script).toContain("targetPackageNames");
    expect(script).toContain('dryRun ? "true" : "false"');
    expect(script).toContain("impact-summary.json");
    expect(script).toContain("summarizeImpact");
    expect(script).toContain("if (!dryRun) {");
    expect(workflow).toContain("actions/upload-artifact");
  });

  it("dispatches dry-run plugin inspector bulk scans after main inspector pin bumps", () => {
    const workflowText = readFileSync(
      resolve(".github/workflows/plugin-inspector-pin-bump-dispatch.yml"),
      "utf8",
    );
    const workflow = parseYaml(workflowText) as {
      on?: {
        push?: {
          branches?: string[];
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

    expect(workflow.on?.push?.branches).toEqual(["main"]);
    expect(workflow.on?.push?.paths).toEqual([
      "package.json",
      "packages/clawhub/package.json",
      "bun.lock",
    ]);
    expect(workflow.permissions?.actions).toBe("write");

    expect(workflowText).toContain("scripts/github/plugin-inspector-pin-change.mjs");
    expect(workflowText).toContain("gh workflow run plugin-inspector-bulk-scan.yml");
    expect(workflowText).toContain("--ref main");
    expect(workflowText).toContain("batch_size=25");
    expect(workflowText).toContain("dry_run=true");
    expect(workflowText).toContain("BASE_SHA: ${{ github.event.before }}");
    expect(workflowText).toContain("HEAD_SHA: ${{ github.sha }}");
    expect(workflowText).toContain(
      'if [ "$BASE_SHA" = "0000000000000000000000000000000000000000" ]',
    );
    expect(workflowText).toContain("skipping fetch for the all-zero base SHA");
    expect(workflowText).toContain("source_sha=${{ github.sha }}");
    expect(workflowText).not.toContain("pull_request_target");
  });

  it("supports publishing a prebuilt ClawPack artifact from a caller workflow", () => {
    const workflow = readFileSync(resolve(".github/workflows/package-publish.yml"), "utf8");

    expect(workflow).toContain("package_artifact_name:");
    expect(workflow).toContain("package_artifact_path:");
    expect(workflow).toContain("publish_json_artifact_name:");
    expect(workflow).toContain("name: ${{ inputs.publish_json_artifact_name }}");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("Download prebuilt package artifact");
    expect(workflow).toContain("actions/download-artifact");
    expect(workflow).toContain("Resolve prebuilt package artifact");
    expect(workflow).toContain("Extract prebuilt package artifact for plugin validation");
    expect(workflow).toContain("INPUT_PACKAGE_ARTIFACT_PATH");
    expect(workflow).toContain("package_artifact_path=");
    expect(workflow).toContain("PREBUILT_PACKAGE_ARTIFACT_PATH");
    expect(workflow).toContain('tarfile.open(archive_path, mode="r:gz")');
    expect(workflow).toContain("archive.extractall(destination, members=safe_members)");
    expect(workflow).not.toContain("tar -xzf");
    expect(workflow).toContain("cmd_source = prebuilt_artifact_path or source");
    expect(workflow).toContain("if prebuilt_artifact_path:");
    expect(workflow).toContain("if not source_repo and not source_commit:");
    expect(workflow).toContain('source_repo = os.environ["GITHUB_REPOSITORY"].strip()');
    expect(workflow).toContain('source_commit = os.environ["GITHUB_SHA"].strip()');
    expect(workflow).toContain(
      "Prebuilt artifact mode requires source_repo and source_commit together",
    );
    expect(workflow).not.toContain("Prebuilt artifact mode does not accept source_path");
    expect(workflow).toContain('cmd += ["--source-path", source_path]');
  });
});
