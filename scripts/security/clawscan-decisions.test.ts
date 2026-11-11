/* @vitest-environment node */
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateDecisionsRun } from "./clawscan-decisions";
import * as dockerCleanup from "./clawscan-docker-cleanup";
import { clawScanExposure, type ClawScanExposure } from "./clawscan-exposure";
import {
  processJob,
  runClawScan,
  validateClawScanArtifactForClawHubProfile,
} from "./run-codex-scan-worker";
import type { ClaimedJob, StoredLlmAnalysis } from "./run-codex-scan-worker";
import { runNativeClawScan } from "./run-prepublication-worker";

const runtimeFixture = vi.hoisted(() => ({
  qualified: false,
  templateQualified: false,
  command: "",
}));
const TEMPLATE_TEST_IMAGE = "ghcr.io/openclaw/clawscan-runtime@sha256:" + "e".repeat(64);
vi.mock("./clawscan-template-runtime", () => ({
  resolveTemplateScanForTarget: async (kind: string, pkg: { family?: string }) =>
    runtimeFixture.templateQualified &&
    kind === "packageRelease" &&
    (pkg?.family === "claw" || pkg?.family === "template")
      ? {
          command: runtimeFixture.command,
          source: "f".repeat(40),
          image: "ghcr.io/openclaw/clawscan-runtime@sha256:" + "e".repeat(64),
        }
      : undefined,
}));
vi.mock("./clawscan-plugin-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clawscan-plugin-runtime")>();
  return {
    ...actual,
    usesWholePluginScanForTarget: async (kind: string, pkg: { family?: string }) =>
      runtimeFixture.qualified &&
      kind === "packageRelease" &&
      (pkg?.family === "code-plugin" || pkg?.family === "bundle-plugin"),
    qualifiedPluginCommand: async () => runtimeFixture.command,
  };
});
import { QUALIFIED_PLUGIN_IMAGE } from "./clawscan-plugin-runtime";

// Wire shape from #148 JudgeResult/JudgeAttempt and #149 ScannerResult/SARIF.
// Synthetic provider response: proves the consumer seam, not live qualification.
function fixture(verdict = "benign") {
  const result = {
    verdict,
    confidence: "high",
    dimensions: Object.fromEntries(
      [
        "purpose_capability",
        "instruction_scope",
        "install_mechanism",
        "environment_proportionality",
        "persistence_privilege",
      ].map((key) => [key, { status: "ok", confidence: 0.9 }]),
    ),
    scan_findings_in_context: [],
    decision: {
      api: "decisions",
      endpointHost: "api.openai.com",
      requestedModel: "requested-model",
      model: "provider-returned-model",
      latencyMs: 30,
      httpAttempts: 1,
      usage: {},
      input: {},
      verdict: { choice: verdict, confidence: 0.9, probabilities: {} },
      signals: {},
    },
  };
  return {
    schemaVersion: "clawscan-run-v1",
    configSource: "built-in",
    profile: "clawhub",
    status: "completed",
    complete: true,
    startedAt: "2026-11-03T00:00:00Z",
    completedAt: "2026-11-03T00:00:01Z",
    scanners: {
      "aig-mcp": {
        status: "completed",
        error: "",
        exitCode: 0,
        durationMs: 10,
        startedAt: "2026-11-03T00:00:00Z",
        completedAt: "2026-11-03T00:00:01Z",
        command: ["aig-mcp-scan", "--repo", "plugin"],
        raw: {
          version: "2.1.0",
          runs: [
            {
              tool: { driver: { name: "aig-mcp-scan", version: "0.2.0" } },
              results: [],
              properties: { scanNote: "complete" },
              invocations: [{ executionSuccessful: true }],
            },
          ],
        },
      },
    },
    judge: {
      status: "completed",
      commandStarted: true,
      command: "clawscan-decisions-judge --workspace workspace",
      configuredModel: "not-the-provider-model",
      error: "",
      result,
      outputSchemaSha256: "a".repeat(64),
      promptSha256: "b".repeat(64),
      attempts: [{ status: "completed", commandStarted: true, error: "", durationMs: 30, result }],
    },
  };
}
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  runtimeFixture.qualified = false;
  runtimeFixture.templateQualified = false;
  runtimeFixture.command = "";
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function runFixture(
  artifact: unknown,
  targetKind: ClaimedJob["job"]["targetKind"] = "packageRelease",
  qualified = false,
  rescan = false,
  family: "code-plugin" | "claw" | "template" = "code-plugin",
  requireDockerConnection = false,
  expectedPublisherTrust?: boolean | "absent",
  options: {
    templateQualified?: boolean;
    layout?: "package";
    exitCode?: number;
    fullProcess?: boolean;
  } = {},
) {
  let exposure: ClawScanExposure | undefined;
  const workspace = await mkdtemp(join(tmpdir(), "decisions-consumer-"));
  dirs.push(workspace);
  await mkdir(join(workspace, "artifact"));
  await writeFile(join(workspace, "artifact", "openclaw.plugin.json"), '{"id":"fixture"}');
  await writeFile(join(workspace, "artifact", "SKILL.md"), "# Embedded skill at plugin root\n");
  if (options.layout === "package") {
    await mkdir(join(workspace, "artifact/package/nested"), { recursive: true });
    await writeFile(
      join(workspace, "artifact/package/package.json"),
      JSON.stringify({
        openclaw: { template: "nested/CLAW.md" },
        dependencies: { "unfetched-fixture": "https://dependency.invalid/package.tgz" },
      }),
    );
    await writeFile(join(workspace, "artifact/package/nested/CLAW.md"), "# Template\n");
  }
  if (qualified || options.templateQualified) {
    const bin = join(workspace, "bin");
    await mkdir(bin);
    const docker = join(bin, "docker");
    await writeFile(
      docker,
      "#!/bin/sh\n" +
        (requireDockerConnection
          ? '[ "$DOCKER_CONTEXT" = scoped-test ] && [ "$DOCKER_CONFIG" = /private/docker-fixture ] || exit 89\n'
          : "") +
        '[ "$1 $2" = "container ls" ] || exit 91\nexit 0\n',
    );
    await chmod(docker, 0o755);
    vi.stubEnv("PATH", bin + ":" + process.env.PATH);
  }
  const command = join(workspace, "clawscan-fixture");
  await writeFile(
    command,
    "#!/usr/bin/env node\n" +
      'require("node:fs").writeFileSync("invocation.json",JSON.stringify(process.argv.slice(2)));\n' +
      (expectedPublisherTrust === undefined
        ? ""
        : 'const fs=require("node:fs");const i=process.argv.indexOf("--context");if(i<0)throw new Error("missing verified publisher context");const c=JSON.parse(fs.readFileSync(process.argv[i+1],"utf8"));require("node:assert/strict").deepEqual(c,{trustedOpenClawPlugin:EXPECTED});\n'.replace(
            "EXPECTED",
            String(expectedPublisherTrust === true),
          )) +
      (requireDockerConnection
        ? 'if(process.env.DOCKER_CONTEXT!=="scoped-test"||process.env.DOCKER_CONFIG!=="/private/docker-fixture")process.exit(88);\n'
        : "") +
      'require("node:fs").writeFileSync(process.argv[process.argv.indexOf("--output")+1], ' +
      JSON.stringify(JSON.stringify(artifact)) +
      ");\n" +
      (options.exitCode ? "process.exit(" + options.exitCode + ");\n" : ""),
  );
  runtimeFixture.qualified = qualified;
  runtimeFixture.templateQualified = options.templateQualified === true;
  runtimeFixture.command = command;
  await chmod(command, 0o755);
  vi.stubEnv("PREPUBLICATION_CLAWSCAN_COMMAND", command);
  vi.stubEnv("CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND", command);
  if (options.fullProcess) {
    const files = {
      "package.json": JSON.stringify({
        openclaw: { template: "nested/CLAW.md" },
        dependencies: { "unfetched-fixture": "https://dependency.invalid/package.tgz" },
      }),
      "nested/CLAW.md": "# Template with an external dependency\n",
      "skills/embedded/SKILL.md": "# Bundled content must not start another scanner\n",
    };
    const actualFetch = globalThis.fetch;
    const downloads: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      downloads.push(url);
      if (!url.startsWith("data:")) throw new Error("Unexpected dependency/audit fetch");
      return actualFetch(input, init);
    });
    vi.stubEnv("CODEX_SECURITY_SCAN_ENDOR_ENABLED", "1");
    const client = { action: vi.fn(async (..._args: unknown[]) => ({})) };
    const result = await processJob(
      client,
      "fixture",
      {
        job: {
          _id: "template-fixture",
          targetKind,
          source: "manual",
          leaseToken: "fixture",
          hasMaliciousSignal: false,
        },
        target: {
          package: { family },
          release: {
            artifactKind: "legacy-zip",
            pluginManifestSummary: { bundledSkills: [{ rootPath: "skills/embedded" }] },
          },
          files: Object.entries(files).map(([path, text]) => ({
            path,
            url: "data:text/plain," + encodeURIComponent(text),
            size: Buffer.byteLength(text),
            sha256: createHash("sha256").update(text).digest("hex"),
          })),
        },
      },
      undefined,
    );
    expect(result).toMatchObject({ completed: true, hardFailed: false });
    expect(downloads).toHaveLength(3);
    expect(client.action).toHaveBeenCalledTimes(1);
    const payload = client.action.mock.calls[0][1] as {
      llmAnalysis: StoredLlmAnalysis;
      skillSpectorAnalysis?: unknown;
      endorAnalysis?: unknown;
    };
    expect(payload.llmAnalysis.verdict).toBe("benign");
    expect(payload.skillSpectorAnalysis).toBeUndefined();
    expect(payload.endorAnalysis).toBeUndefined();
    return { analysis: payload.llmAnalysis, check: { status: "process", summary: undefined } };
  }
  if (rescan) {
    let invocation: string[] | undefined;
    const job: ClaimedJob = {
      job: {
        _id: "fixture",
        targetKind,
        source: "manual",
        leaseToken: "fixture",
        hasMaliciousSignal: false,
      },
      target: {
        trustedOpenClawPlugin:
          expectedPublisherTrust === "absent" ? undefined : expectedPublisherTrust,
        package: { family, name: "@openclaw/unverified-name" },
        release: {
          artifactKind: options.layout === "package" ? "npm-pack" : "legacy-zip",
          endorAnalysis: { private: "must not pass" },
        },
      },
    };
    const mapped = await runClawScan(job, workspace, (diagnostic) => {
      if (diagnostic.args) invocation = diagnostic.args;
      if (diagnostic.exposure) exposure = diagnostic.exposure;
    });
    expect(invocation).toContain(
      targetKind === "skillVersion"
        ? "./artifact/SKILL.md"
        : family === "claw" || family === "template"
          ? options.layout === "package"
            ? "./artifact/package"
            : "./artifact"
          : "./artifact/openclaw.plugin.json",
    );
    if (targetKind !== "skillVersion" && family !== "claw" && family !== "template")
      expect(invocation).toContain(QUALIFIED_PLUGIN_IMAGE);
    expect(invocation).not.toContain("--scanner-result");
    if (options.templateQualified) {
      expect(invocation).toContain("clawhub-template");
      expect(invocation).toContain(TEMPLATE_TEST_IMAGE);
      expect(invocation).not.toContain("--context");
      expect(exposure).toEqual(templateExposure);
    }
    return { analysis: mapped.llmAnalysis, check: { status: "rescan", summary: undefined } };
  }
  const result = await runNativeClawScan(
    {
      job: {
        _id: "fixture",
        targetKind,
        source: "pre-publication",
        leaseToken: "fixture",
        hasMaliciousSignal: false,
      },
      target: {
        trustedOpenClawPlugin:
          expectedPublisherTrust === "absent" ? undefined : expectedPublisherTrust,
        package: { family, name: "@openclaw/unverified-name" },
        release: {
          artifactKind: options.layout === "package" ? "npm-pack" : "legacy-zip",
          endorAnalysis: { private: "must not pass" },
        },
      },
    },
    workspace,
    (next) => {
      exposure = next;
    },
  );
  if (options.templateQualified) {
    const invocation: string[] = JSON.parse(
      await readFile(join(workspace, "invocation.json"), "utf8"),
    );
    expect(invocation[0]).toBe(options.layout === "package" ? "./artifact/package" : "./artifact");
    expect(invocation).toContain("clawhub-template");
    expect(invocation).toContain(TEMPLATE_TEST_IMAGE);
    expect(invocation).not.toContain("--scanner-result");
    expect(invocation).not.toContain("--context");
    if (result.analysis) expect(exposure).toEqual(templateExposure);
  }
  return result;
}
async function partialSkillFixture(verdict: string, exitCode: number) {
  const artifact = fixture(verdict) as Record<string, any>;
  delete artifact.judge.result.decision;
  delete artifact.judge.command;
  artifact.judge.outputSchemaPath = "evidence-judge.schema.json";
  artifact.judge.promptPath = "evidence-judge.md";
  const raw = JSON.parse(
    await readFile(new URL("./fixtures/skillspector-usable-partial.json", import.meta.url), "utf8"),
  );
  const execution = artifact.scanners["aig-mcp"];
  artifact.scanners = {
    skillspector: {
      ...execution,
      status: "partial",
      reportPolicy: "judge-gaps",
      exitCode,
      command: ["skillspector", "analyze"],
      raw,
    },
    aig: {
      ...execution,
      command: ["aig-skill-scan"],
      raw: {
        ...execution.raw,
        runs: [
          {
            ...execution.raw.runs[0],
            tool: { driver: { name: "aig-skill-scan", version: "fixture" } },
          },
        ],
      },
    },
  };
  return artifact;
}

async function completedSkillFixture(verdict = "benign") {
  const artifact = await partialSkillFixture(verdict, 1);
  const scanner = artifact.scanners.skillspector;
  scanner.status = "completed";
  delete scanner.reportPolicy;
  // Native SkillSpector uses exit 1 for findings and retains process stderr.
  scanner.error = "exit status 1: UserWarning: Pydantic serializer warnings";
  scanner.raw = {
    execution_successful: true,
    metadata: { skillspector_version: "fixture" },
    components: [{ path: "SKILL.md", type: "markdown" }],
    issues: [{ id: "fixture-finding", severity: "HIGH", description: "Controlled finding" }],
    analysis_completeness: {
      execution_successful: true,
      is_complete: true,
      status: "complete",
      total_components: 1,
      scanned_components: 1,
      fully_inspected_files: 1,
      partially_inspected_files: 0,
      entirely_uninspected_files: 0,
      coverage_percent: 100,
    },
  };
  return artifact;
}

describe("Scanner-report-only Codex publication consumer", () => {
  it.each([false, true, "absent"] as const)(
    "passes only backend-verified publisher trust into both native judge lanes (trusted=%s)",
    async (trusted) => {
      const artifact = fixture() as Record<string, any>;
      artifact.sandbox = { mode: "docker", image: QUALIFIED_PLUGIN_IMAGE };
      for (const rescan of [false, true]) {
        expect(
          (
            await runFixture(
              artifact,
              "packageRelease",
              true,
              rescan,
              "code-plugin",
              false,
              trusted,
            )
          ).analysis?.verdict,
        ).toBe("benign");
      }
    },
  );

  it("accepts the typed native Codex verdict without inventing Decisions evidence or artifact inspection", async () => {
    const artifact = fixture() as Record<string, any>;
    delete artifact.judge.result.decision;
    delete artifact.judge.command;
    artifact.judge.outputSchemaPath = "evidence-judge.schema.json";
    artifact.judge.promptPath = "evidence-judge.md";
    artifact.judge.configuredModel = "gpt-6.1-sol";
    artifact.sandbox = { mode: "docker", image: QUALIFIED_PLUGIN_IMAGE };
    delete artifact.judge.commandStarted;
    delete artifact.judge.attempts[0].commandStarted;
    const mapped = validateClawScanArtifactForClawHubProfile(artifact, ["aig-mcp"]);
    expect(mapped.llmAnalysis).toMatchObject({
      status: "clean",
      verdict: "benign",
      confidence: "high",
      model: "gpt-6.1-sol",
    });
    expect(mapped.llmAnalysis).not.toHaveProperty("decision");
    expect(mapped.llmAnalysis).not.toHaveProperty("artifact_inspection");
    expect(clawScanExposure(artifact)).toMatchObject({
      eligibleScanAttempt: true,
      judgeInvocations: 1,
      judgeOperationalFailures: 0,
    });
    const published = await runFixture(artifact, "packageRelease", true);
    expect(published.analysis).toMatchObject({ status: "clean", verdict: "benign" });
  });
  it.each([false, true])(
    "accepts Template ordinary scanner evidence (qualified=%s)",
    async (qualified) => {
      const artifact = fixture() as Record<string, any>;
      delete artifact.judge.result.decision;
      delete artifact.judge.command;
      artifact.judge.outputSchemaPath = "evidence-judge.schema.json";
      artifact.judge.promptPath = "evidence-judge.md";
      const execution = artifact.scanners["aig-mcp"];
      artifact.scanners = {
        skillspector: { ...execution, command: ["skillspector", "analyze"], raw: { issues: [] } },
      };
      const result = await runFixture(artifact, "packageRelease", qualified, false, "claw");
      expect(result.check.status).toBe("clean");
      expect(result.analysis?.verdict).toBe("benign");
      expect("aigAnalysis" in result ? result.aigAnalysis : undefined).toBeUndefined();
    },
  );
  it.each(["benign", "suspicious", "malicious"])(
    "preserves native %s for completed SkillSpector findings exits",
    async (verdict) => {
      const artifact = await completedSkillFixture(verdict);
      const scanner = artifact.scanners.skillspector;
      const result = await runFixture(artifact, "skillVersion");
      expect(result.check.status, JSON.stringify(result.check)).toBe(
        verdict === "malicious" ? "blocked" : "clean",
      );
      expect(result.analysis?.verdict).toBe(verdict);
      expect(
        JSON.parse(validateClawScanArtifactForClawHubProfile(artifact).scannerReportsJson)
          .skillspector,
      ).toEqual(scanner.raw);
    },
  );

  it.each([
    "crash exit",
    "unrecognized process error",
    "unsuccessful report",
    "unsuccessful accounting",
    "missing accounting",
    "incomplete accounting",
    "failed accounting",
    "malformed findings",
    "malformed native issues with findings alias",
    "impossible accounting",
    "missing component accounting",
    "inconsistent component totals",
    "excess scanned components",
    "negative coverage",
    "negative findings count",
    "increasing filtered findings",
    "negative analyzer counter",
    "report error",
    "imported report",
    "missing AIG",
    "failed judge",
  ])("rejects completed findings evidence with %s", async (scenario) => {
    const artifact = await completedSkillFixture();
    const scanner = artifact.scanners.skillspector;
    if (scenario === "crash exit") scanner.exitCode = 2;
    if (scenario === "unrecognized process error") scanner.error = "scanner crashed";
    if (scenario === "unsuccessful report") scanner.raw.execution_successful = false;
    if (scenario === "unsuccessful accounting")
      scanner.raw.analysis_completeness.execution_successful = false;
    if (scenario === "missing accounting") delete scanner.raw.analysis_completeness;
    if (scenario === "incomplete accounting") scanner.raw.analysis_completeness.is_complete = false;
    if (scenario === "failed accounting") scanner.raw.analysis_completeness.status = "failed";
    if (scenario === "malformed findings") scanner.raw.issues = [null];
    if (scenario === "malformed native issues with findings alias") {
      scanner.raw.issues = [null];
      scanner.raw.filtered_findings = [];
    }
    if (scenario === "impossible accounting") {
      scanner.raw.analysis_completeness.total_components = -1;
      scanner.raw.analysis_completeness.coverage_percent = 1000;
    }
    if (scenario === "missing component accounting")
      delete scanner.raw.analysis_completeness.total_components;
    if (scenario === "inconsistent component totals")
      scanner.raw.analysis_completeness.fully_inspected_files = 2;
    if (scenario === "excess scanned components")
      scanner.raw.analysis_completeness.scanned_components = 2;
    if (scenario === "negative coverage") scanner.raw.analysis_completeness.coverage_percent = -1;
    if (scenario === "negative findings count")
      scanner.raw.analysis_completeness.findings_before_filtering = -1;
    if (scenario === "increasing filtered findings") {
      scanner.raw.analysis_completeness.findings_before_filtering = 1;
      scanner.raw.analysis_completeness.findings_after_filtering = 2;
    }
    if (scenario === "negative analyzer counter")
      scanner.raw.analysis_completeness.analyzer_statuses = [{ completed: -1 }];
    if (scenario === "report error") scanner.raw.error = "failed inspection";
    if (scenario === "imported report") scanner.command = ["scanner-result"];
    if (scenario === "missing AIG") delete artifact.scanners.aig;
    if (scenario === "failed judge") artifact.judge.status = "failed";
    const result = await runFixture(artifact, "skillVersion");
    expect(result.check.status).toBe("failed");
    expect(() => validateClawScanArtifactForClawHubProfile(artifact)).toThrow();
  });

  it.each(
    [false, true].flatMap((rescan) =>
      [0, 1].flatMap((exitCode) =>
        ["benign", "suspicious"].map((verdict) => ({ rescan, exitCode, verdict })),
      ),
    ),
  )(
    "preserves native $verdict over usable partial evidence (exit=$exitCode, rescan=$rescan)",
    async ({ verdict, exitCode, rescan }) => {
      const artifact = await partialSkillFixture(verdict, exitCode);
      const raw = artifact.scanners.skillspector.raw;
      const result = await runFixture(artifact, "skillVersion", false, rescan, "claw");
      expect(result.analysis, JSON.stringify(result.check)).toMatchObject({
        status: verdict === "benign" ? "clean" : "suspicious",
        verdict,
      });
      expect(result.analysis).not.toHaveProperty("decision");
      expect(result.check.status).not.toBe("failed");
      const mapped = validateClawScanArtifactForClawHubProfile(artifact);
      expect(mapped.mapping).toMatchObject({ skillSpectorReportPolicy: "judge-gaps" });
      expect(JSON.parse(mapped.scannerReportsJson).skillspector).toEqual(raw);
    },
  );

  it.each([
    "missing policy",
    "malformed raw",
    "unsuccessful execution",
    "crash",
    "scanner error",
    "imported report",
    "missing exit",
    "missing AIG",
    "failed judge",
  ])("rejects partial typed evidence with %s in both worker consumers", async (scenario) => {
    const artifact = await partialSkillFixture("benign", 1);
    const scanner = artifact.scanners.skillspector;
    if (scenario === "missing policy") delete scanner.reportPolicy;
    if (scenario === "malformed raw") scanner.raw = { issues: [] };
    if (scenario === "unsuccessful execution") scanner.raw.execution_successful = false;
    if (scenario === "crash") scanner.exitCode = 2;
    if (scenario === "scanner error") scanner.error = "scanner crashed";
    if (scenario === "imported report") scanner.command = ["scanner-result"];
    if (scenario === "missing exit") delete scanner.exitCode;
    if (scenario === "missing AIG") delete artifact.scanners.aig;
    if (scenario === "failed judge") artifact.judge.status = "failed";
    const result = await runFixture(artifact, "skillVersion", false, false, "claw");
    expect(result.check.status).toBe("failed");
    expect(result.analysis).toBeUndefined();
    await expect(runFixture(artifact, "skillVersion", false, true, "claw")).rejects.toThrow();
  });

  it("runs Template rescan scanners natively instead of importing bundled evidence", async () => {
    const artifact = fixture() as Record<string, any>;
    delete artifact.judge.result.decision;
    delete artifact.judge.command;
    artifact.judge.outputSchemaPath = "evidence-judge.schema.json";
    artifact.judge.promptPath = "evidence-judge.md";
    artifact.scanners = {
      skillspector: {
        ...artifact.scanners["aig-mcp"],
        command: ["skillspector", "scan"],
        raw: { issues: [] },
      },
    };
    expect(
      (await runFixture(artifact, "packageRelease", true, true, "claw")).analysis?.verdict,
    ).toBe("benign");
  });

  it("rejects Template evidence with missing ordinary scanner coverage", async () => {
    const artifact = fixture() as Record<string, any>;
    delete artifact.judge.result.decision;
    delete artifact.judge.command;
    artifact.judge.outputSchemaPath = "evidence-judge.schema.json";
    artifact.judge.promptPath = "evidence-judge.md";
    artifact.scanners = { aig: { ...artifact.scanners["aig-mcp"], command: ["aig-skill-scan"] } };
    const result = await runFixture(artifact, "packageRelease", false, false, "claw");
    expect(result.check.status).toBe("failed");
    expect(result.check.summary).toContain("skillspector");
  });

  it.each([false, true])(
    "preserves scoped Docker settings through worker execution and cleanup (rescan=%s)",
    async (rescan) => {
      vi.stubEnv("DOCKER_CONTEXT", "scoped-test");
      vi.stubEnv("DOCKER_CONFIG", "/private/docker-fixture");
      const artifact = fixture() as Record<string, any>;
      artifact.sandbox = { mode: "docker", image: QUALIFIED_PLUGIN_IMAGE };
      expect(
        (await runFixture(artifact, "packageRelease", true, rescan, "code-plugin", true)).analysis
          ?.verdict,
      ).toBe("benign");
    },
  );

  it("accepts native EvidenceOnly provenance when Command is deliberately omitted", () => {
    const artifact = fixture() as Record<string, any>;
    delete artifact.judge.result.decision;
    delete artifact.judge.command;
    artifact.judge.configuredModel = "gpt-6.1-sol";
    artifact.judge.outputSchemaPath = "evidence-judge.schema.json";
    artifact.judge.promptPath = "evidence-judge.md";
    expect(
      validateClawScanArtifactForClawHubProfile(artifact, ["aig-mcp"]).llmAnalysis,
    ).toMatchObject({ verdict: "benign", model: "gpt-6.1-sol" });
  });

  it.each([
    "incomplete",
    "failed",
    "invalid verdict",
    "missing dimension",
    "inconsistent attempt",
    "unrecognized schema",
    "missing scanner",
    "invented decision",
  ])("fails closed for scanner-only Codex %s", (scenario) => {
    const artifact = fixture() as Record<string, any>;
    delete artifact.judge.result.decision;
    delete artifact.judge.command;
    artifact.judge.outputSchemaPath = "evidence-judge.schema.json";
    artifact.judge.promptPath = "evidence-judge.md";
    if (scenario === "incomplete") artifact.complete = false;
    if (scenario === "failed") artifact.judge.status = "failed";
    if (scenario === "invalid verdict") artifact.judge.result.verdict = "unknown";
    if (scenario === "missing dimension") delete artifact.judge.result.dimensions.instruction_scope;
    if (scenario === "inconsistent attempt") artifact.judge.attempts[0].result = {};
    if (scenario === "unrecognized schema")
      artifact.judge.outputSchemaPath = "artifact-schema.json";
    if (scenario === "missing scanner") delete artifact.scanners["aig-mcp"];
    if (scenario === "invented decision") artifact.judge.result.decision = { api: "decisions" };
    expect(() => validateClawScanArtifactForClawHubProfile(artifact, ["aig-mcp"])).toThrow();
  });
});

describe("Decisions publication consumer", () => {
  it("validates native Docker output recovery without inventing unknown-start invocation counts", () => {
    const artifact = fixture() as Record<string, any>;
    delete artifact.judge.commandStarted;
    delete artifact.judge.attempts[0].commandStarted;
    artifact.judge.attempts.unshift({
      status: "failed",
      error: "Judge did not return a JSON object",
      result: null,
      durationMs: 10,
    });
    expect(() => validateClawScanArtifactForClawHubProfile(artifact, ["aig-mcp"])).not.toThrow();
    expect(clawScanExposure(artifact)).toMatchObject({
      judgeInvocations: null,
      judgeOperationalFailures: null,
      recoveredReceiptRetries: 0,
    });
  });

  it("accepts the actual native Docker omitted-start shape and keeps its optional overview", async () => {
    const artifact = fixture() as Record<string, any>;
    artifact.sandbox = { mode: "docker", image: QUALIFIED_PLUGIN_IMAGE };
    delete artifact.judge.commandStarted;
    delete artifact.judge.attempts[0].commandStarted;
    artifact.overview = {
      status: "completed",
      error: "",
      result: {
        summary: "Native Docker overview.",
        user_guidance: "Native guidance.",
        scan_findings_in_context: [],
        dimensions: Object.fromEntries(
          Object.keys(artifact.judge.result.dimensions).map((key) => [key, "Native detail."]),
        ),
      },
    };
    const result = await runFixture(artifact, "packageRelease", true);
    expect(result.check.status).toBe("clean");
    expect(result.analysis).toMatchObject({
      verdict: "benign",
      summary: "Native Docker overview.",
      guidance: "Native guidance.",
    });
    expect(clawScanExposure(artifact)).toMatchObject({
      judgeInvocations: 1,
      judgeOperationalFailures: 0,
    });
  });

  it("keeps the verdict publishable when optional overview failed before any child command started", async () => {
    const artifact = fixture() as Record<string, any>;
    artifact.sandbox = { mode: "docker", image: QUALIFIED_PLUGIN_IMAGE };
    artifact.overview = {
      status: "failed",
      commandStarted: false,
      error: "Overview could not start",
    };
    const result = await runFixture(artifact, "packageRelease", true);
    expect(result.check.status).toBe("clean");
    expect(result.analysis).toMatchObject({ verdict: "benign" });
    expect(result.analysis?.summary).toBeUndefined();
  });

  it.each(["benign", "suspicious", "malicious"])(
    "uses the qualified verdict mapper for manual %s rescan",
    async (verdict) => {
      const artifact = fixture(verdict) as Record<string, any>;
      artifact.sandbox = { mode: "docker", image: QUALIFIED_PLUGIN_IMAGE };
      delete artifact.scanners["aig-mcp"].raw.runs[0].invocations;
      const result = await runFixture(artifact, "packageRelease", true, true);
      expect(result.analysis).toMatchObject({ verdict, model: "provider-returned-model" });
    },
  );
  it.each([
    ["benign", "clean"],
    ["suspicious", "clean"],
    ["malicious", "blocked"],
  ])("accepts %s only through qualified image-backed execution", async (verdict, expected) => {
    const artifact = fixture(verdict) as Record<string, any>;
    artifact.sandbox = { mode: "docker", image: QUALIFIED_PLUGIN_IMAGE };
    // Actual upstream AIG MCP 0.2.0 SARIF omits invocations.
    delete artifact.scanners["aig-mcp"].raw.runs[0].invocations;
    const result = await runFixture(artifact, "packageRelease", true);
    expect(result.check.status).toBe(expected);
    expect(result.analysis).toMatchObject({ verdict, model: "provider-returned-model" });
    expect(result.analysis?.summary).toBeUndefined();
  });
  it.each([
    "provider/exhaustion failure",
    "coverage failure",
    "missing scanner",
    "host execution",
    "mutable image",
  ])("rejects qualified-source %s", async (reason) => {
    const artifact = fixture() as Record<string, any>;
    artifact.sandbox = { mode: "docker", image: QUALIFIED_PLUGIN_IMAGE };
    if (reason === "provider/exhaustion failure")
      Object.assign(artifact.scanners["aig-mcp"], {
        status: "failed",
        error: "aig-mcp-scan exhausted its iteration budget",
      });
    if (reason === "missing scanner") delete artifact.scanners["aig-mcp"];
    if (reason === "coverage failure")
      artifact.scanners["aig-mcp"].raw.runs[0].properties.scanNote = "incomplete";
    if (reason === "host execution") artifact.sandbox.mode = "off";
    if (reason === "mutable image")
      artifact.sandbox.image = "ghcr.io/openclaw/clawscan-runtime:latest";
    expect((await runFixture(artifact, "packageRelease", true)).check.status).toBe("failed");
  });

  it("rejects standalone skill evidence for a plugin claim", async () => {
    const artifact = fixture() as Record<string, any>;
    artifact.scanners.aig = artifact.scanners["aig-mcp"];
    artifact.scanners.aig.raw.runs[0].tool.driver.name = "aig-skill-scan";
    artifact.scanners.skillspector = { ...artifact.scanners.aig, raw: { issues: [] } };
    delete artifact.scanners["aig-mcp"];
    expect((await runFixture(artifact)).check.status).toBe("failed");
    expect(() => validateClawScanArtifactForClawHubProfile(artifact, ["aig-mcp"])).toThrow();
  });

  it.each([
    ["benign", "clean"],
    ["suspicious", "clean"],
    ["malicious", "blocked"],
  ])("maps %s without inventing prose", async (verdict, check) => {
    const result = await runFixture(fixture(verdict));
    expect(result.check.status).toBe("failed");
    expect(result.check.summary).toContain("qualified source");
    const projected = validateClawScanArtifactForClawHubProfile(fixture(verdict), ["aig-mcp"]);
    expect(projected.llmAnalysis).toMatchObject({
      verdict,
      model: "provider-returned-model",
      status: verdict === "benign" ? "clean" : verdict,
    });
    expect(projected.llmAnalysis.summary).toBeUndefined();
    expect(check).toBe(verdict === "malicious" ? "blocked" : "clean");
  });
  it("rejects plugin evidence for a standalone skill", async () => {
    expect((await runFixture(fixture(), "skillVersion")).check.status).toBe("failed");
    expect(() => validateClawScanArtifactForClawHubProfile(fixture())).toThrow();
  });
  it.each([
    "custom profile",
    "missing judge",
    "failed judge",
    "imported scanner",
    "unsuccessful invocation",
    "mixed-case invocation",
    "coverage gap",
    "empty output",
    "no command",
    "synthetic time",
    "inconsistent attempt",
    "missing verdict",
  ])("fails closed: %s", async (scenario) => {
    const artifact = fixture() as Record<string, any>;
    const scanner = artifact.scanners["aig-mcp"];
    if (scenario === "custom profile") artifact.configSource = "artifact/clawscan.yml";
    if (scenario === "missing judge") delete artifact.judge;
    if (scenario === "failed judge") artifact.judge.status = "failed";
    if (scenario === "imported scanner") scanner.command = ["scanner-result", "aig-mcp=file.json"];
    if (scenario === "unsuccessful invocation")
      scanner.raw.runs[0].invocations[0].executionSuccessful = false;
    if (scenario === "mixed-case invocation")
      scanner.raw.runs[0].invocations[0].ExecutionSuccessful = false;
    if (scenario === "coverage gap") scanner.raw.runs[0].properties.scanNote = "incomplete";
    if (scenario === "empty output") scanner.raw = {};
    if (scenario === "no command") scanner.command = [];
    if (scenario === "synthetic time") {
      delete scanner.exitCode;
      delete scanner.durationMs;
    }
    if (scenario === "inconsistent attempt") artifact.judge.attempts[0].result = {};
    if (scenario === "missing verdict") delete artifact.judge.result.verdict;
    expect(() => validateClawScanArtifactForClawHubProfile(artifact, ["aig-mcp"])).toThrow();
    expect((await runFixture(artifact)).check.status).toBe("failed");
  });
  it("takes prose only from a successful optional overview", async () => {
    const artifact = fixture() as Record<string, any>;
    artifact.overview = {
      status: "completed",
      commandStarted: true,
      error: "",
      result: {
        summary: "Optional overview.",
        user_guidance: "Optional guidance.",
        scan_findings_in_context: [],
        dimensions: Object.fromEntries(
          Object.keys(artifact.judge.result.dimensions).map((key) => [key, "Overview detail."]),
        ),
      },
    };
    expect(
      validateClawScanArtifactForClawHubProfile(artifact, ["aig-mcp"]).llmAnalysis,
    ).toMatchObject({ summary: "Optional overview.", guidance: "Optional guidance." });
    artifact.overview.status = "failed";
    artifact.overview.error = "timeout";
    const result = validateClawScanArtifactForClawHubProfile(artifact, ["aig-mcp"]);
    expect(result.llmAnalysis.status).toBe("clean");
    expect(result.llmAnalysis.summary).toBeUndefined();
  });
  it("accounts actual execution without removed receipts or static scanner", () => {
    const artifact = fixture();
    expect(clawScanExposure(artifact)).toMatchObject({
      eligibleScanAttempt: true,
      judgeInvocations: 1,
      judgeOperationalFailures: 0,
      recoveredReceiptRetries: 0,
    });
    artifact.scanners["aig-mcp"].command = ["scanner-result", "aig-mcp=saved.json"];
    expect(clawScanExposure(artifact).eligibleScanAttempt).toBe(false);
    artifact.scanners["aig-mcp"].command = [];
    expect(clawScanExposure(artifact).eligibleScanAttempt).toBe(false);
    artifact.complete = false;
    expect(clawScanExposure(artifact).eligibleScanAttempt).toBe(false);
  });
});

// Synthetic consumer receipts exercise trust boundaries; actual runtime
// qualification is a separate native execution check, never a fixture claim.
const templateExposure: ClawScanExposure = {
  scanExecution: "started",
  eligibleScanAttempt: true,
  judgeInvocations: 1,
  judgeOperationalFailures: 0,
  recoveredReceiptRetries: 0,
};
function templateFixture(verdict = "benign") {
  const artifact = fixture(verdict) as Record<string, any>;
  artifact.profile = "clawhub-template";
  artifact.target = { kind: "template" };
  artifact.sandbox = { mode: "docker", image: TEMPLATE_TEST_IMAGE };
  delete artifact.judge.result.decision;
  delete artifact.judge.command;
  artifact.judge.outputSchemaPath = "evidence-judge.schema.json";
  artifact.judge.promptPath = "evidence-judge.md";
  return artifact;
}

describe("Template-only native MCP consumer", () => {
  it.each([
    { label: "missing", target: undefined },
    { label: "null", target: null },
    { label: "missing kind", target: {} },
    { label: "skill", target: { kind: "skill" } },
    { label: "plugin", target: { kind: "plugin" } },
    { label: "unknown", target: { kind: "unknown" } },
    { label: "malformed kind", target: { kind: 42 } },
    { label: "array", target: [{ kind: "template" }] },
  ])("rejects $label native target in both Template APIs and workers", async ({ target }) => {
    const artifact = templateFixture();
    if (target === undefined) delete artifact.target;
    else artifact.target = target;
    expect(() => validateDecisionsRun(artifact, ["aig-mcp"], "clawhub-template")).toThrow(
      "native target.kind=template",
    );
    expect(() =>
      validateClawScanArtifactForClawHubProfile(artifact, ["aig-mcp"], "clawhub-template"),
    ).toThrow("native target.kind=template");
    for (const family of ["claw", "template"] as const) {
      const options = { templateQualified: true };
      const result = await runFixture(
        artifact,
        "packageRelease",
        false,
        false,
        family,
        false,
        undefined,
        options,
      );
      expect(result.check.status).toBe("failed");
      expect(result.check.summary).toContain("native target.kind=template");
      expect(result.analysis).toBeUndefined();
      await expect(
        runFixture(artifact, "packageRelease", false, true, family, false, undefined, options),
      ).rejects.toThrow("native target.kind=template");
    }
    // The existing ordinary profile does not acquire a new target restriction.
    artifact.profile = "clawhub";
    expect(validateDecisionsRun(artifact, ["aig-mcp"]).verdict).toBe("benign");
    expect(
      validateClawScanArtifactForClawHubProfile(artifact, ["aig-mcp"]).llmAnalysis.verdict,
    ).toBe("benign");
  });

  it("accepts the native Template target in both explicitly selected consumer APIs", () => {
    const artifact = templateFixture();
    expect(validateDecisionsRun(artifact, ["aig-mcp"], "clawhub-template").verdict).toBe("benign");
    expect(
      validateClawScanArtifactForClawHubProfile(artifact, ["aig-mcp"], "clawhub-template")
        .llmAnalysis.verdict,
    ).toBe("benign");
  });

  it("accounts for Template exposure only with the caller-owned expected profile", () => {
    const artifact = templateFixture();
    expect(clawScanExposure(artifact).eligibleScanAttempt).toBeNull();
    expect(clawScanExposure(artifact, "clawhub-template")).toEqual(templateExposure);
    artifact.profile = "clawhub";
    expect(clawScanExposure(artifact, "clawhub-template").judgeInvocations).toBeNull();
    expect(clawScanExposure(artifact)).toEqual(templateExposure);
  });

  it.each(["claw", "template"] as const)(
    "does not fetch dependency audits or prepare companion scanners for %s rescans",
    async (family) => {
      await runFixture(templateFixture(), "packageRelease", false, true, family, false, undefined, {
        templateQualified: true,
        fullProcess: true,
      });
    },
  );

  it.each(["claw", "template"] as const)(
    "selects %s only from a qualified backend claim in both workers",
    async (family) => {
      for (const rescan of [false, true]) {
        for (const layout of [undefined, "package"] as const) {
          const result = await runFixture(
            templateFixture(),
            "packageRelease",
            false,
            rescan,
            family,
            false,
            undefined,
            {
              templateQualified: true,
              layout,
            },
          );
          expect(result.analysis?.verdict).toBe("benign");
          if (!rescan) expect(result.check.status).toBe("clean");
        }
      }
    },
  );

  it.each(["benign", "suspicious", "malicious"])(
    "preserves %s rather than deriving a verdict from SARIF severity",
    async (verdict) => {
      const artifact = templateFixture(verdict);
      artifact.scanners["aig-mcp"].raw.runs[0].results = [
        {
          ruleId: "fixture",
          level: "error",
          message: { text: "Controlled high-severity finding" },
        },
      ];
      for (const rescan of [false, true]) {
        const result = await runFixture(
          artifact,
          "packageRelease",
          false,
          rescan,
          "template",
          false,
          undefined,
          { templateQualified: true },
        );
        expect(result.analysis?.verdict).toBe(verdict);
        if (!rescan)
          expect(result.check.status).toBe(verdict === "malicious" ? "blocked" : "clean");
      }
    },
  );

  it("never accepts a returned Template profile as caller authority", async () => {
    expect(() =>
      validateClawScanArtifactForClawHubProfile(templateFixture(), ["aig-mcp"]),
    ).toThrow();
    for (const family of ["claw", "template"] as const) {
      expect(
        (await runFixture(templateFixture(), "packageRelease", false, false, family)).check.status,
      ).toBe("failed");
      await expect(
        runFixture(templateFixture(), "packageRelease", false, true, family),
      ).rejects.toThrow();
    }
  });

  it.each([
    "wrong profile",
    "extra scanner",
    "imported report",
    "wrong driver",
    "incomplete SARIF",
    "multiple SARIF runs",
    "failed scanner",
    "failed judge",
    "Decisions judge",
    "wrong image",
    "host artifact",
  ])("rejects %s in both qualified Template consumers", async (scenario) => {
    const artifact = templateFixture();
    const scanner = artifact.scanners["aig-mcp"];
    if (scenario === "wrong profile") artifact.profile = "clawhub";
    if (scenario === "extra scanner") artifact.scanners.skillspector = scanner;
    if (scenario === "imported report") scanner.command = ["scanner-result", "aig-mcp=report.json"];
    if (scenario === "wrong driver") scanner.raw.runs[0].tool.driver.name = "aig-skill-scan";
    if (scenario === "incomplete SARIF") scanner.raw.runs[0].properties.scanNote = "partial";
    if (scenario === "multiple SARIF runs") scanner.raw.runs.push(scanner.raw.runs[0]);
    if (scenario === "failed scanner") scanner.exitCode = 1;
    if (scenario === "failed judge") artifact.judge.status = "failed";
    if (scenario === "Decisions judge") artifact.judge = fixture().judge;
    if (scenario === "wrong image") artifact.sandbox.image = QUALIFIED_PLUGIN_IMAGE;
    if (scenario === "host artifact") artifact.sandbox.mode = "off";
    const options = { templateQualified: true };
    const result = await runFixture(
      artifact,
      "packageRelease",
      false,
      false,
      "claw",
      false,
      undefined,
      options,
    );
    expect(result.check.status).toBe("failed");
    expect(result.analysis).toBeUndefined();
    await expect(
      runFixture(artifact, "packageRelease", false, true, "claw", false, undefined, options),
    ).rejects.toThrow();
  });

  it("requires exactly AIG MCP in the trusted expected scanner set", () => {
    for (const scanners of [
      ["skillspector"],
      ["aig-mcp", "clawscan-static"],
      ["aig-mcp", "aig-mcp"],
    ]) {
      expect(() =>
        validateClawScanArtifactForClawHubProfile(templateFixture(), scanners, "clawhub-template"),
      ).toThrow();
    }
  });

  it("retains fail-closed Docker cleanup on native process failure, not a malicious verdict", async () => {
    const actual = dockerCleanup.withClawScanDockerCleanup;
    vi.spyOn(dockerCleanup, "withClawScanDockerCleanup").mockImplementation((input) =>
      actual({ ...input, cleanupTimeoutMs: 50, pollIntervalMs: 5 }),
    );
    const options = { templateQualified: true, exitCode: 1 };
    for (const rescan of [false, true]) {
      await expect(
        runFixture(
          templateFixture("malicious"),
          "packageRelease",
          false,
          rescan,
          "claw",
          false,
          undefined,
          options,
        ),
      ).rejects.toBeInstanceOf(dockerCleanup.ClawScanContainerCleanupError);
    }
  });
});
