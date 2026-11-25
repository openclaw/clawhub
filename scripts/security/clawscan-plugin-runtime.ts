import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { qualifiedNativeCommand, assertQualifiedNativeArtifact } from "./clawscan-native-runtime";

// ClawScan 0.4.0 candidate, bound to native runtime run 45562677164.
// The matching host binary selects the built-in profile; scanner tools run
// inside this source-bound immutable image.
// No mutable image tag or host MCP fallback.
export const QUALIFIED_PLUGIN_SOURCE = "9bc83753a6f1af7ff077917262190ada0152891b";
export const QUALIFIED_PLUGIN_IMAGE =
  "ghcr.io/openclaw/clawscan-runtime@sha256:5036a4a3d62175f85092c20736cba96c89ecc45b9ddf74e8ba7a0462d8b396ed";

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
  return qualifiedNativeCommand(
    lane,
    { source: QUALIFIED_PLUGIN_SOURCE, image: QUALIFIED_PLUGIN_IMAGE },
    env,
    "plugin",
  );
}

export function assertQualifiedPluginArtifact(artifact: Record<string, unknown>) {
  assertQualifiedNativeArtifact(artifact, {
    source: QUALIFIED_PLUGIN_SOURCE,
    image: QUALIFIED_PLUGIN_IMAGE,
  });
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
