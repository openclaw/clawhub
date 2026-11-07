import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { verifyInstalledClawScanSource } from "./prepublicationScannerSource";

// Exact merged EvidenceOnly source + native image from runtime run 42292655384.
// No mutable image tag or host MCP fallback.
export const QUALIFIED_PLUGIN_SOURCE = "80d11a34a97a9181213c806fc3013123360f9012";
export const QUALIFIED_PLUGIN_IMAGE =
  "ghcr.io/openclaw/clawscan-runtime@sha256:d494938b84a9f0da40504f611eec472d4637c755b5cef87b123daf8a2014545c";

// Capability discovery is followed by source/binary verification before execution.
// The old pin has no override, so it keeps its existing scanner/target behavior.
export async function usesWholePluginScan(env: NodeJS.ProcessEnv = process.env) {
  if (!env.CLAWSCAN_SOURCE_DIR) return false;
  const file = join(env.CLAWSCAN_SOURCE_DIR, "internal/profiles/clawhub/clawscan.yml");
  const raw = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (raw === undefined) return false;
  const profile = parseYaml(raw)?.profiles?.clawhub;
  const ids = profile?.pluginScanners;
  if (ids === undefined) return false;
  const judge = profile?.judge;
  const evidenceJudge =
    judge?.evidenceOnly === true &&
    /\bcodex\s+exec\b/.test(String(judge?.command)) &&
    String(judge?.command).includes("evidence-judge.schema.json") &&
    Array.isArray(profile?.scanners) &&
    profile.scanners.length === 2 &&
    profile.scanners.includes("skillspector") &&
    profile.scanners.includes("aig");
  if (
    !Array.isArray(ids) ||
    ids.length !== 1 ||
    ids[0] !== "aig-mcp" ||
    (!evidenceJudge && !String(judge?.command).includes("clawscan-decisions-judge"))
  ) {
    throw new Error(
      "Installed ClawScan plugin profile has not qualified for the typed scanner judge consumer",
    );
  }
  return true;
}

export async function qualifiedPluginCommand(
  lane: "PREPUBLICATION" | "CODEX_SECURITY_SCAN",
  env: NodeJS.ProcessEnv = process.env,
) {
  const sandbox = (
    env[lane + "_CLAWSCAN_PLUGIN_SANDBOX"] ?? env[lane + "_CLAWSCAN_SANDBOX"]
  )?.trim();
  const image = env[lane + "_CLAWSCAN_SANDBOX_IMAGE"]?.trim();
  if ((sandbox && sandbox !== "docker") || (image && image !== QUALIFIED_PLUGIN_IMAGE)) {
    throw new Error(
      "A.I.G MCP requires the qualified immutable Docker runtime; host execution is unavailable",
    );
  }
  const runtime = await verifyInstalledClawScanSource(
    env,
    QUALIFIED_PLUGIN_SOURCE,
    env[lane + "_CLAWSCAN_COMMAND"],
    true,
  );
  return runtime.command;
}

export function assertQualifiedPluginArtifact(artifact: Record<string, unknown>) {
  const sandbox = artifact.sandbox as Record<string, unknown> | null | undefined;
  if (!sandbox || sandbox.mode !== "docker" || sandbox.image !== QUALIFIED_PLUGIN_IMAGE) {
    throw new Error("A.I.G MCP artifact did not use the qualified immutable Docker runtime");
  }
}

export async function usesWholePluginScanForTarget(
  targetKind: string,
  pkg: unknown,
  env: NodeJS.ProcessEnv = process.env,
) {
  const family =
    pkg && typeof pkg === "object" ? (pkg as Record<string, unknown>).family : undefined;
  return (
    targetKind === "packageRelease" &&
    (family === "code-plugin" || family === "bundle-plugin") &&
    (await usesWholePluginScan(env))
  );
}
