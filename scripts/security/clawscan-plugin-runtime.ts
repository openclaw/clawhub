import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { verifyInstalledClawScanSource } from "./prepublicationScannerSource";

// Explicitly prepared compatibility source/image; not the production source pin
// or activation configuration. No mutable image tag or host MCP fallback.
export const QUALIFIED_PLUGIN_SOURCE = "56d17aaa423cdb1ed87aeda970b9a2b30eed7dd8";
export const QUALIFIED_PLUGIN_IMAGE =
  "ghcr.io/openclaw/clawscan-runtime@sha256:9c765a089a034451c428d563f0f09f4004c898ac14802470bb6a58fca7755960";

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
  if (
    !Array.isArray(ids) ||
    ids.length !== 1 ||
    ids[0] !== "aig-mcp" ||
    !String(profile?.judge?.command).includes("clawscan-decisions-judge")
  ) {
    throw new Error(
      "Installed ClawScan plugin profile has not qualified for the Decisions consumer",
    );
  }
  return true;
}

export async function qualifiedPluginCommand(
  lane: "PREPUBLICATION" | "CODEX_SECURITY_SCAN",
  env: NodeJS.ProcessEnv = process.env,
) {
  const sandbox = env[lane + "_CLAWSCAN_SANDBOX"]?.trim();
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
