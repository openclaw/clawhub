import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { EndorAnalysis } from "../../convex/lib/endorAnalysis";
import { derivePluginManifestSummary } from "../../convex/lib/packageRegistry";
import { parseClawPack } from "../../packages/clawhub/src/clawpack";
import { redactWorkerPublicErrorMessage } from "../lib/workerRedaction";
import {
  runClawScan,
  writeJobDiagnostic,
  type ClaimedJob,
  type ClawScanCommandDiagnostic,
} from "./run-codex-scan-worker";
import {
  EndorContainerCleanupError,
  runEndorPluginScan,
  type EndorCommandDiagnostic,
} from "./run-endor-plugin-scan";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    help: { type: "boolean", short: "h" },
    "prepare-only": { type: "boolean" },
    "trusted-openclaw": { type: "boolean" },
  },
});

if (values.help || !positionals.length) {
  console.log(`Usage: bun scripts/security/scan-local-plugins.ts [--out DIR] [--prepare-only] plugin.tgz ...

Runs the production ClawHub plugin profile, including Endor and one AI judge.
Writes local reports only; never submits results or changes moderation.
Findings do not fail the command; scanner or judge failures exit nonzero.
--prepare-only validates and unpacks packages without calling any scanner.
--trusted-openclaw asserts that these artifacts belong to the verified OpenClaw
publisher, matching production's first-party policy. It never bypasses the judge.

Full scans require OPENAI_API_KEY, ENDOR_NAMESPACE, ENDOR_API_CREDENTIALS_KEY,
ENDOR_API_CREDENTIALS_SECRET, CODEX_SECURITY_SCAN_ENDOR_IMAGE, Docker, and
ClawScan 0.2.0 and SkillSpector on PATH (or CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND).
Use Bun's --env-file option to load a private environment file.

Example: bun --env-file=/private/path/scanners.env scripts/security/scan-local-plugins.ts --out .artifacts/plugin-scans releases/*.tgz`);
  process.exit(values.help ? 0 : 2);
}

if (!values["prepare-only"]) {
  const required = [
    "OPENAI_API_KEY",
    "ENDOR_NAMESPACE",
    "ENDOR_API_CREDENTIALS_KEY",
    "ENDOR_API_CREDENTIALS_SECRET",
    "CODEX_SECURITY_SCAN_ENDOR_IMAGE",
  ];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error(`Missing scan settings: ${missing.join(", ")}`);
}

await mkdir(resolve(".artifacts"), { recursive: true });
const out = values.out ? resolve(values.out) : await mkdtemp(resolve(".artifacts/plugin-scans-"));
await mkdir(out, { recursive: true });
const results: Array<{
  name: string;
  version: string;
  artifact: string;
  sha256: string;
  workspace: string;
  status: "prepared" | "completed" | "failed";
  durationMs: number;
  endorAnalysis?: EndorAnalysis;
  llmAnalysis?: Awaited<ReturnType<typeof runClawScan>>["llmAnalysis"];
  error?: string;
}> = [];

for (const [index, input] of positionals.entries()) {
  const startedAt = Date.now();
  const artifact = resolve(input);
  const bytes = await readFile(artifact);
  const packed = parseClawPack(bytes);
  if (!packed.pluginManifest) throw new Error(`${artifact}: openclaw.plugin.json is required`);
  const workspace = await mkdtemp(join(out, `plugin-${index + 1}-`));
  const packageRoot = join(workspace, "artifact", "package");
  for (const entry of packed.entries) {
    const path = join(packageRoot, entry.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, entry.bytes);
  }
  const pluginManifestSummary = derivePluginManifestSummary({
    pluginManifest: packed.pluginManifest,
    files: packed.entries.map((entry) => ({
      path: entry.path,
      size: entry.bytes.length,
      sha256: createHash("sha256").update(entry.bytes).digest("hex"),
      ...(entry.path.toLowerCase().endsWith("skill.md")
        ? { text: new TextDecoder().decode(entry.bytes) }
        : {}),
    })),
  });
  // Mirror the package metadata consumed by the production worker; no client or lease is used.
  const job: ClaimedJob = {
    job: {
      _id: `local-${index + 1}`,
      leaseToken: "",
      targetKind: "packageRelease",
      source: "local-report",
      hasMaliciousSignal: false,
      waitForVtUntil: 0,
    },
    target: {
      trustedOpenClawPlugin: values["trusted-openclaw"] === true,
      package: { name: packed.packageName },
      release: { version: packed.packageVersion, artifactKind: "npm-pack", pluginManifestSummary },
    },
  };
  const result: (typeof results)[number] = {
    name: packed.packageName,
    version: packed.packageVersion,
    artifact,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    workspace,
    status: "prepared",
    durationMs: 0,
  };
  console.log(
    `[${index + 1}/${positionals.length}] ${result.name}@${result.version}: ${values["prepare-only"] ? "preparing" : "Endor scan"}`,
  );
  let stop = false;
  if (!values["prepare-only"]) {
    const endor: EndorCommandDiagnostic = {};
    const clawscan: ClawScanCommandDiagnostic = {};
    try {
      try {
        result.endorAnalysis = await runEndorPluginScan({
          workspace,
          onDiagnostic: (next) => Object.assign(endor, next),
        });
      } catch (error) {
        endor.error = redactWorkerPublicErrorMessage(
          error instanceof Error ? error.message : String(error),
        );
        if (error instanceof EndorContainerCleanupError) throw error;
        result.endorAnalysis = {
          status: "failed",
          checkedAt: Date.now(),
          reason: "Endor analysis failed. Request a rescan to try again.",
        };
      }
      console.log(
        `[${index + 1}/${positionals.length}] ${result.name}: ClawScan scanners + AI judge`,
      );
      const scanned = await runClawScan(
        job,
        workspace,
        (next) => Object.assign(clawscan, next),
        result.endorAnalysis,
      );
      result.llmAnalysis = scanned.llmAnalysis;
      result.status = "completed";
    } catch (error) {
      result.status = "failed";
      result.error = redactWorkerPublicErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      stop = error instanceof EndorContainerCleanupError;
    }
    await writeJobDiagnostic({
      job,
      endor,
      clawscan,
      diagnosticsRoot: join(out, "diagnostics"),
      startedAt,
      completedAt: Date.now(),
      status: result.status === "completed" ? "completed" : "failed",
      error: result.error,
      llmAnalysis: result.llmAnalysis,
    });
  }
  result.durationMs = Date.now() - startedAt;
  results.push(result);
  await writeFile(join(out, "report.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(
    `[${index + 1}/${positionals.length}] ${result.name}: ${result.status}, verdict=${result.llmAnalysis?.verdict ?? "none"}, Endor=${result.endorAnalysis?.status ?? "not run"}, ${Math.round(result.durationMs / 1000)}s`,
  );
  if (stop) throw new Error(`Stopped after unconfirmed Docker cleanup. Preserve ${workspace}.`);
}

console.log(`Report: ${join(out, "report.json")}`);
if (!values["prepare-only"]) console.log(`Diagnostics: ${join(out, "diagnostics")}`);
if (
  results.some((result) => result.status === "failed" || result.endorAnalysis?.status === "failed")
) {
  process.exitCode = 1;
}
