import {
  qualifiedNativeCommand,
  type ClawScanWorkerLane,
  type ReviewedClawScanRuntime,
} from "./clawscan-native-runtime";
import { QUALIFIED_PLUGIN_IMAGE, QUALIFIED_PLUGIN_SOURCE } from "./clawscan-plugin-runtime";

export type TemplateScanRuntime = ReviewedClawScanRuntime & { command: string };

// The host Go producer embeds/selects this profile. Only the unchanged scanner
// tools execute inside the already-qualified immutable Docker image. Bind both
// lanes to the same reviewed source; artifact text cannot select a revision.
const REVIEWED_TEMPLATE_RUNTIME: ReviewedClawScanRuntime = {
  source: QUALIFIED_PLUGIN_SOURCE,
  image: QUALIFIED_PLUGIN_IMAGE,
};

export async function resolveTemplateScanForTarget(
  targetKind: string,
  pkg: unknown,
  lane: ClawScanWorkerLane,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TemplateScanRuntime | undefined> {
  const runtime = REVIEWED_TEMPLATE_RUNTIME;
  const family =
    pkg && typeof pkg === "object" ? (pkg as Record<string, unknown>).family : undefined;
  if (targetKind !== "packageRelease" || (family !== "claw" && family !== "template"))
    return undefined;
  return {
    ...runtime,
    command: await qualifiedNativeCommand(lane, runtime, env, "template"),
  };
}
