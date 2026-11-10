import {
  qualifiedNativeCommand,
  type ClawScanWorkerLane,
  type ReviewedClawScanRuntime,
} from "./clawscan-native-runtime";

export type TemplateScanRuntime = ReviewedClawScanRuntime & { command: string };

// Pending reviewed runtime rollout. The current reviewed host source does not
// contain clawhub-template. Bind the new host source/binary/profile to a qualified
// immutable scanner image (which may be reused unchanged); no environment
// override, returned profile, or artifact marker activates it.
const REVIEWED_RUNTIMES: { template?: ReviewedClawScanRuntime } = {};

export async function resolveTemplateScanForTarget(
  targetKind: string,
  pkg: unknown,
  lane: ClawScanWorkerLane,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TemplateScanRuntime | undefined> {
  const runtime = REVIEWED_RUNTIMES.template;
  const family =
    pkg && typeof pkg === "object" ? (pkg as Record<string, unknown>).family : undefined;
  if (targetKind !== "packageRelease" || (family !== "claw" && family !== "template") || !runtime)
    return undefined;
  return {
    ...runtime,
    command: await qualifiedNativeCommand(lane, runtime, env),
  };
}
