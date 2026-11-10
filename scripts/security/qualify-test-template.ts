import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { pluginScanBudget, securityWorkerDeadline } from "../../convex/lib/securityWorkerBudgets";
import { ClawScanContainerCleanupError } from "./clawscan-docker-cleanup";
import { assertQualifiedNativeArtifact } from "./clawscan-native-runtime";
import { QUALIFIED_PLUGIN_IMAGE, QUALIFIED_PLUGIN_SOURCE } from "./clawscan-plugin-runtime";
import { resolveTemplateScanForTarget } from "./clawscan-template-runtime";
import {
  type ClaimedJob,
  validateClawScanArtifactForClawHubProfile,
} from "./run-codex-scan-worker";
import { runNativeClawScan, runNativeTruffleHog } from "./run-prepublication-worker";

const fixtureRoot = new URL("./fixtures/template-qualification/", import.meta.url);
// No caller-selected artifact, command, source, attempt, or output path.
const fixtureFiles = [
  "package.json",
  "CLAW.md",
  "BOOTSTRAP.md",
  "automations/review.json",
  "workspace/PLAN.md",
  "skills/notes/SKILL.md",
  "plugins/checklist/openclaw.plugin.json",
  "plugins/checklist/index.js",
] as const;

type Failure =
  | "configuration"
  | "deadline"
  | "runtime"
  | "fixture"
  | "secrets"
  | "native_execution"
  | "native_evidence"
  | "unexpected_verdict"
  | "artifact_changed"
  | "cleanup"
  | "docker_cleanup";
type Verdict = "benign" | "suspicious" | "malicious";
type QualificationReceipt = {
  schemaVersion: "clawhub-template-native-qualification-v1";
  mode: "nonpublishing";
  status: "passed" | "failed";
  failure: Failure | null;
  workerRevision: string | null;
  source: typeof QUALIFIED_PLUGIN_SOURCE;
  image: typeof QUALIFIED_PLUGIN_IMAGE;
  profile: "clawhub-template";
  targetKind: "template";
  sourceAndBinaryVerified: boolean;
  secretGate: "not_run" | "clean" | "blocked" | "failed";
  nativeEvidence: "not_validated" | "completed";
  verdict: Verdict | null;
  artifactSha256: string | null;
  fixtureSha256: string | null;
  fixtureUnchanged: boolean;
  workspaceRemoved: boolean;
};

async function fixtureDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  const walk = async (dir: string, prefix = "") => {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name);
      const relative = prefix + name;
      const stat = await lstat(path);
      if (stat.isDirectory()) await walk(path, relative + "/");
      else if (stat.isFile()) {
        hash
          .update(relative + "\0")
          .update(await readFile(path))
          .update("\0");
      } else throw new Error("Non-regular fixture entry");
    }
  };
  await walk(root);
  return hash.digest("hex");
}

export async function qualifyTestTemplate(
  args = process.argv.slice(2),
): Promise<QualificationReceipt> {
  const receipt: QualificationReceipt = {
    schemaVersion: "clawhub-template-native-qualification-v1",
    mode: "nonpublishing",
    status: "failed",
    failure: null,
    workerRevision: /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? "")
      ? process.env.GITHUB_SHA!
      : null,
    source: QUALIFIED_PLUGIN_SOURCE,
    image: QUALIFIED_PLUGIN_IMAGE,
    profile: "clawhub-template",
    targetKind: "template",
    sourceAndBinaryVerified: false,
    secretGate: "not_run",
    nativeEvidence: "not_validated",
    verdict: null,
    artifactSha256: null,
    fixtureSha256: null,
    fixtureUnchanged: false,
    workspaceRemoved: false,
  };
  let workspace: string | undefined;
  let preserveWorkspace = false;
  let stage: Failure = "configuration";
  try {
    if (
      args.length ||
      process.env.GITHUB_REF !== "refs/heads/main" ||
      !receipt.workerRevision ||
      process.env.CONVEX_URL !== "https://academic-chihuahua-392.convex.cloud" ||
      !process.env.OPENAI_API_KEY?.trim() ||
      !process.env.CODEX_API_KEY?.trim() ||
      !process.env.LLM_API_KEY?.trim() ||
      process.env.CONVEX_DEPLOY_KEY ||
      process.env.SECURITY_SCAN_WORKER_TOKEN ||
      process.env.ATTEMPT_ID ||
      process.env.PREPUBLICATION_TRUFFLEHOG_COMMAND
    )
      throw new Error("Invalid qualification environment");
    stage = "deadline";
    const now = Date.now();
    if (
      !process.env.SECURITY_SCAN_WORKER_HOST_DEADLINE_MS ||
      now + pluginScanBudget.publicationJobMs >
        securityWorkerDeadline(
          now,
          pluginScanBudget.publicationWorkerMs,
          process.env.SECURITY_SCAN_WORKER_HOST_DEADLINE_MS,
        )
    ) {
      throw new Error("Insufficient native drain window");
    }
    stage = "runtime";
    const runtime = await resolveTemplateScanForTarget(
      "packageRelease",
      { family: "template" },
      "PREPUBLICATION",
    );
    if (!runtime) throw new Error("No qualified Template runtime");
    receipt.sourceAndBinaryVerified = true;
    stage = "fixture";
    workspace = await mkdtemp(join(tmpdir(), "template-qualification-"));
    const artifact = join(workspace, "artifact");
    for (const file of fixtureFiles) {
      const source = new URL(file, fixtureRoot);
      if (!(await lstat(source)).isFile()) throw new Error("Non-regular fixture file");
      const target = join(artifact, file);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readFile(source), { mode: 0o600 });
    }
    receipt.fixtureSha256 = await fixtureDigest(artifact);
    stage = "deadline";
    // Source verification and preparation consumed host time; do not admit a
    // full native job against the earlier preflight observation.
    if (
      Date.now() + pluginScanBudget.publicationJobMs >
      securityWorkerDeadline(
        now,
        pluginScanBudget.publicationWorkerMs,
        process.env.SECURITY_SCAN_WORKER_HOST_DEADLINE_MS,
      )
    ) {
      throw new Error("Insufficient native drain window after preparation");
    }
    stage = "secrets";
    const secrets = await runNativeTruffleHog(workspace);
    receipt.secretGate = secrets.status;
    if (secrets.status !== "clean") throw new Error("Secret gate did not pass");
    stage = "native_execution";
    // Local adapter only: these labels are not Convex IDs or leases. Never call
    // processPrePublicationAttempt/writeArtifactWorkspace or construct a client.
    const job: ClaimedJob = {
      job: {
        _id: "nonpublishing-template-qualification",
        leaseToken: "",
        targetKind: "packageRelease",
        source: "nonpublishing-qualification",
        hasMaliciousSignal: false,
      },
      target: { package: { family: "template" }, release: { artifactKind: "legacy-zip" } },
    };
    const result = await runNativeClawScan(job, workspace);
    if (result.check.status === "failed") throw new Error("Native execution failed");
    stage = "native_evidence";
    const bytes = await readFile(join(workspace, "clawscan-result.json"));
    const report = JSON.parse(bytes.toString("utf8"));
    assertQualifiedNativeArtifact(report, runtime);
    // Reuse the consumer's full native command/SARIF/completeness/judge/hash
    // contract, not process exit or model-authored summary text as proof.
    const mapped = validateClawScanArtifactForClawHubProfile(
      report,
      ["aig-mcp"],
      "clawhub-template",
    );
    const verdict = mapped.llmAnalysis.verdict;
    if (verdict !== "benign" && verdict !== "suspicious" && verdict !== "malicious")
      throw new Error("Nonterminal verdict");
    receipt.nativeEvidence = "completed";
    receipt.verdict = verdict;
    receipt.artifactSha256 = createHash("sha256").update(bytes).digest("hex");
    stage = "artifact_changed";
    receipt.fixtureUnchanged = receipt.fixtureSha256 === (await fixtureDigest(artifact));
    if (!receipt.fixtureUnchanged) throw new Error("Fixture changed during scan");
    stage = "unexpected_verdict";
    // The normal publication lane still admits suspicious and blocks malicious.
    // This known benign fixture must be benign; do not retry for a desired verdict.
    if (verdict !== "benign" || result.check.status !== "clean")
      throw new Error("Unexpected fixture verdict");
    receipt.status = "passed";
  } catch (error) {
    preserveWorkspace = error instanceof ClawScanContainerCleanupError;
    receipt.failure = preserveWorkspace ? "docker_cleanup" : stage;
  } finally {
    // Match the worker custody contract: never delete mounts while daemon
    // cleanup/finality is uncertain. The failed hosted runner owns teardown.
    if (workspace && !preserveWorkspace) {
      try {
        await rm(workspace, { recursive: true, force: true });
        receipt.workspaceRemoved = true;
      } catch {
        receipt.status = "failed";
        receipt.failure = "cleanup";
      }
    }
  }
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const receipt = await qualifyTestTemplate();
  // Only bounded enums, booleans, pins and hashes; never raw reports or errors.
  console.log(JSON.stringify(receipt));
  process.exitCode = receipt.status === "passed" ? 0 : 1;
}
