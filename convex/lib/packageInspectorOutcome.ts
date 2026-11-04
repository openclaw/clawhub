import { v, type Infer } from "convex/values";

// Plugin Inspector is advisory monitoring. These outcomes keep real plugin
// findings apart from the tool failing to inspect, so an Inspector crash, OOM,
// or timeout is never recorded or shown as plugin breakage.
export const packageInspectorOutcomeValidator = v.union(
  v.literal("clean"),
  v.literal("findings"),
  v.literal("tool_failure"),
  v.literal("timeout"),
);

export type PackageInspectorOutcome = Infer<typeof packageInspectorOutcomeValidator>;

export const packageInspectorFailureReasonValidator = v.union(
  v.literal("out_of_memory"),
  v.literal("target_unavailable"),
  v.literal("timeout"),
  v.literal("error"),
);

export type PackageInspectorFailureReason = Infer<typeof packageInspectorFailureReasonValidator>;

export const packageInspectorFailureValidator = v.object({
  stage: v.string(),
  reason: packageInspectorFailureReasonValidator,
  message: v.string(),
});

export type PackageInspectorFailure = Infer<typeof packageInspectorFailureValidator>;

// Publish-time failures can happen before the OpenClaw target resolves; their
// scan state still needs a key, and this value never matches a real target.
export const UNRESOLVED_OPENCLAW_TARGET_VERSION = "unresolved";

const PACKAGE_INSPECTOR_TARGET_STAGE = "OpenClaw target preparation";

const MAX_FAILURE_MESSAGE_LENGTH = 300;

export function isPackageInspectorFailureOutcome(outcome: PackageInspectorOutcome | undefined) {
  return outcome === "tool_failure" || outcome === "timeout";
}

export function classifyPackageInspectorFailure(
  error: unknown,
  stage: string,
): { outcome: "tool_failure" | "timeout"; failure: PackageInspectorFailure } {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/\s+/g, " ").trim().slice(0, MAX_FAILURE_MESSAGE_LENGTH);
  if (/out of memory|heap limit|ERR_WORKER_OUT_OF_MEMORY|\bOOM\b/i.test(raw)) {
    return { outcome: "tool_failure", failure: { stage, reason: "out_of_memory", message } };
  }
  if (/timed out|timeout|ETIMEDOUT/i.test(raw)) {
    return { outcome: "timeout", failure: { stage, reason: "timeout", message } };
  }
  if (stage === PACKAGE_INSPECTOR_TARGET_STAGE) {
    return { outcome: "tool_failure", failure: { stage, reason: "target_unavailable", message } };
  }
  return { outcome: "tool_failure", failure: { stage, reason: "error", message } };
}
