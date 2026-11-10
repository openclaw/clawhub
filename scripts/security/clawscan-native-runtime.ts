import { verifyInstalledClawScanSource } from "./prepublicationScannerSource";

export type ReviewedClawScanRuntime = { source: string; image: string };
export type ClawScanWorkerLane = "PREPUBLICATION" | "CODEX_SECURITY_SCAN";

// A built-in profile is not authority to execute it: bind its clean source and
// installed binary to one reviewed immutable native image before invocation.
export async function qualifiedNativeCommand(
  lane: ClawScanWorkerLane,
  runtime: ReviewedClawScanRuntime,
  env: NodeJS.ProcessEnv = process.env,
  pluginSandboxOverride = false,
) {
  const sandbox = (
    (pluginSandboxOverride ? env[lane + "_CLAWSCAN_PLUGIN_SANDBOX"] : undefined) ??
    env[lane + "_CLAWSCAN_SANDBOX"]
  )?.trim();
  const image = env[lane + "_CLAWSCAN_SANDBOX_IMAGE"]?.trim();
  if (
    !/^[a-f0-9]{40}$/.test(runtime.source) ||
    !/^ghcr\.io\/openclaw\/clawscan-runtime@sha256:[a-f0-9]{64}$/.test(runtime.image) ||
    (sandbox && sandbox !== "docker") ||
    (image && image !== runtime.image)
  ) {
    throw new Error(
      "A.I.G MCP requires the qualified immutable Docker runtime; host execution is unavailable",
    );
  }
  const installed = await verifyInstalledClawScanSource(
    env,
    runtime.source,
    env[lane + "_CLAWSCAN_COMMAND"],
    true,
  );
  return installed.command;
}

export function assertQualifiedNativeArtifact(
  artifact: Record<string, unknown>,
  runtime: ReviewedClawScanRuntime,
) {
  const sandbox = artifact.sandbox as Record<string, unknown> | null | undefined;
  if (!sandbox || sandbox.mode !== "docker" || sandbox.image !== runtime.image) {
    throw new Error("A.I.G MCP artifact did not use the qualified immutable Docker runtime");
  }
}
