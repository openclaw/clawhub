import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { reusableAigAnalysis } from "./aigAnalysis";

export function isSingleScanPlugin(family: Doc<"packages">["family"] | undefined) {
  return family === "code-plugin" || family === "bundle-plugin";
}

/** Automatic plugin work supplements the admitted verdict; it never re-judges it. */
export function isExplicitPluginScanSource(source: Doc<"securityScanJobs">["source"]) {
  return source === "manual" || source === "bulk-rescan";
}

export function assertPluginScanEvidence(
  llmAnalysis: Doc<"packageReleases">["llmAnalysis"],
  aigAnalysis: Doc<"packageReleases">["aigAnalysis"],
  expectedCheck?: "clean" | "blocked",
) {
  const status = llmAnalysis?.status.trim().toLowerCase();
  const verdict = (llmAnalysis?.verdict ?? status)?.trim().toLowerCase();
  if (
    !llmAnalysis ||
    !Number.isFinite(llmAnalysis.checkedAt) ||
    !["clean", "benign", "suspicious", "malicious"].includes(verdict ?? "") ||
    !["completed", "clean", "benign", "suspicious", "malicious"].includes(status ?? "") ||
    !reusableAigAnalysis(aigAnalysis) ||
    (expectedCheck === "clean" && verdict === "malicious") ||
    (expectedCheck === "blocked" && verdict !== "malicious")
  ) {
    throw new ConvexError(
      "Plugin scans require completed ClawScan and A.I.G evidence matching the publication decision.",
    );
  }
}
