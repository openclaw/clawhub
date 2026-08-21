import { spawnSync } from "node:child_process";
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

  it("runs nightly beta plugin scans while preserving manual dispatch", () => {
    const workflow = readFileSync(
      resolve(".github/workflows/plugin-inspector-bulk-scan.yml"),
      "utf8",
    );
    const parsedWorkflow = parseYaml(workflow) as {
      on?: {
        schedule?: Array<{ cron?: string }>;
        workflow_dispatch?: {
          inputs?: {
            dry_run?: { default?: string };
            notification_only?: { default?: boolean };
            notification_source_run_id?: { default?: string };
            notify_owners?: { default?: boolean };
            package_names?: { default?: string };
          };
        };
      };
    };
    const script = readFileSync(resolve("scripts/package-inspector-nightly-scan.ts"), "utf8");
    const http = readFileSync(resolve("convex/packageInspectorHttp.ts"), "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(parsedWorkflow.on?.schedule).toEqual([{ cron: "17 7 * * *" }]);
    expect(workflow).toContain("Maximum plugin releases to scan");
    expect(workflow).toContain("Plugin Inspector Bulk Scan");
    expect(workflow).toContain("plugin-inspector-bulk-scan-reports");
    expect(workflow).toContain("source_pr:");
    expect(workflow).toContain("source_sha:");
    expect(workflow).toContain(
      "concurrency:\n  group: clawhub-plugin-inspector-bulk-scan\n  cancel-in-progress: false",
    );
    expect(workflow).toContain("PLUGIN_INSPECTOR_OPENCLAW_VERSION: beta");
    expect(workflow).toContain("notify_owners:");
    expect(parsedWorkflow.on?.workflow_dispatch?.inputs?.notify_owners?.default).toBe(false);
    expect(parsedWorkflow.on?.workflow_dispatch?.inputs?.notification_only?.default).toBe(false);
    expect(parsedWorkflow.on?.workflow_dispatch?.inputs?.notification_source_run_id?.default).toBe(
      "",
    );
    expect(workflow).toContain(
      "PLUGIN_INSPECTOR_NOTIFY_OWNERS: ${{ github.event_name == 'schedule' && '0' || (inputs.notify_owners && '1' || '0') }}",
    );
    expect(workflow).toContain("ref: main");
    expect(workflow).toContain("if: ${{ github.ref == 'refs/heads/main' }}");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN");
    expect(workflow).toContain("Download reviewed scan artifact");
    expect(workflow).toContain("PLUGIN_INSPECTOR_NOTIFICATION_MANIFEST");
    expect(script).toContain("package-inspector/claim");
    expect(script).toContain("prepareBulkOpenClawTarget");
    expect(script).toContain("targetOpenClaw: preparedTarget.target");
    expect(script).toContain("targetOpenClawVersion");
    expect(script).toContain("skippedUnchanged");
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

  it("revalidates a supplied trusted tooling tuple immediately before publication", () => {
    const workflowText = readFileSync(resolve(".github/workflows/package-publish.yml"), "utf8");
    const workflow = parseYaml(workflowText) as {
      on?: {
        workflow_call?: {
          inputs?: Record<
            string,
            { default?: boolean | number | string; required?: boolean; type?: string }
          >;
        };
      };
      jobs?: {
        publish?: {
          steps?: Array<{
            env?: Record<string, string>;
            if?: string;
            name?: string;
            run?: string;
          }>;
        };
      };
    };
    const steps = workflow.jobs?.publish?.steps ?? [];
    const verifyIndex = steps.findIndex(
      (step) => step.name === "Revalidate trusted tooling identity",
    );
    const publishIndex = steps.findIndex((step) => step.name === "Run package publish");
    const verifyStep = steps[verifyIndex];

    expect(workflow.on?.workflow_call?.inputs?.trusted_tooling_identity_json).toEqual({
      description:
        "Optional versioned trusted tooling workflow identity JSON to revalidate immediately before publication.",
      required: false,
      type: "string",
      default: "",
    });
    expect(verifyIndex).toBeGreaterThan(-1);
    expect(verifyIndex + 1).toBe(publishIndex);
    expect(verifyStep?.if).toBe("inputs.trusted_tooling_identity_json != ''");
    expect(verifyStep?.env).toMatchObject({
      GH_TOKEN: "${{ github.token }}",
      TRUSTED_TOOLING_IDENTITY_JSON: "${{ inputs.trusted_tooling_identity_json }}",
      GITHUB_REPOSITORY: "${{ github.repository }}",
      GITHUB_RUN_ID: "${{ github.run_id }}",
      GITHUB_RUN_ATTEMPT: "${{ github.run_attempt }}",
      GITHUB_WORKFLOW_REF: "${{ github.workflow_ref }}",
      GITHUB_WORKFLOW_SHA: "${{ github.workflow_sha }}",
      GITHUB_REF: "${{ github.ref }}",
      GITHUB_REF_NAME: "${{ github.ref_name }}",
      GITHUB_SHA: "${{ github.sha }}",
      GITHUB_EVENT_NAME: "${{ github.event_name }}",
    });
    expect(verifyStep?.run).toContain("verify-trusted-tooling-identity.cjs");
  });

  it("passes the trusted tooling identity behavior contract", () => {
    const result = spawnSync(
      process.execPath,
      ["--test", ".github/scripts/verify-trusted-tooling-identity.node-test.cjs"],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/# tests [1-9][0-9]*/);
    expect(result.stdout).toContain("# fail 0");
  });

  it("forwards optional catalog metadata and changelog inputs", () => {
    const workflowText = readFileSync(resolve(".github/workflows/package-publish.yml"), "utf8");
    const workflow = parseYaml(workflowText) as {
      on?: {
        workflow_call?: {
          inputs?: Record<string, { required?: boolean; type?: string }>;
        };
      };
      jobs?: {
        publish?: {
          steps?: Array<{ name?: string; env?: Record<string, string>; run?: string }>;
        };
      };
    };
    const inputs = workflow.on?.workflow_call?.inputs;
    const resolveStep = workflow.jobs?.publish?.steps?.find(
      (step) => step.name === "Resolve publish command",
    );

    for (const name of ["changelog", "categories", "topics"]) {
      const envName = `INPUT_${name.toUpperCase()}`;
      expect(inputs?.[name]).toMatchObject({ required: false, type: "string" });
      expect(resolveStep?.env?.[envName]).toBe(`\${{ inputs.${name} }}`);
      expect(resolveStep?.run).toContain(`${name} = os.environ["${envName}"].strip()`);
      expect(resolveStep?.run).toContain(`if ${name}:\n    cmd += ["--${name}", ${name}]`);
    }

    for (const name of ["categories", "topics"]) {
      const clearName = `clear_${name}`;
      const envName = `INPUT_CLEAR_${name.toUpperCase()}`;
      expect(inputs?.[clearName]).toMatchObject({
        required: false,
        type: "boolean",
        default: false,
      });
      expect(resolveStep?.env?.[envName]).toBe(`\${{ inputs.${clearName} }}`);
      expect(resolveStep?.run).toContain(
        `${clearName} = os.environ["${envName}"].strip().lower() == "true"`,
      );
      expect(resolveStep?.run).toContain(
        `if ${name} and ${clearName}:\n    raise SystemExit("${name} and ${clearName} cannot be combined")`,
      );
      expect(resolveStep?.run).toContain(`elif ${clearName}:\n    cmd += ["--${name}", ""]`);
    }
  });

  it("keeps a metadata value carrying CR or LF from opening a second log line", () => {
    const workflow = readFileSync(resolve(".github/workflows/package-publish.yml"), "utf8");

    // shlex.quote is shell quoting, not output escaping: it wraps a value in single quotes
    // and leaves an embedded line break intact, so a changelog, categories or topics value
    // carrying one would reach the runner as its own ::workflow-command line.
    expect(workflow).toContain(
      [
        "              quoted = shlex.quote(part)",
        "              return quoted if quoted.isprintable() else json.dumps(part)",
      ].join("\n"),
    );
    expect(workflow).toContain('print(" ".join(quote_for_log(part) for part in cmd))');
    expect(workflow).not.toContain("print(shell_line)");

    // The re-runnable .sh file is a real shell script, so it keeps plain shell quoting.
    expect(workflow).toContain('shell_line = " ".join(shlex.quote(part) for part in cmd)');
  });
});
