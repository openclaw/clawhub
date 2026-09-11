import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

export async function readVersionScannerReports(
  ctx: Pick<ActionCtx, "storage">,
  version: Pick<
    Doc<"skillVersions">,
    "scannerReportsStorageId" | "llmAnalysis" | "aigAnalysis" | "skillSpectorAnalysis"
  >,
): Promise<{ aig: unknown; skillspector: unknown }> {
  const unavailable = { aig: null, skillspector: null };
  if (!version.scannerReportsStorageId) return unavailable;
  const blob = await ctx.storage.get(version.scannerReportsStorageId);
  if (!blob) return unavailable;
  const stored: { checkedAt: number; aig: unknown; skillspector: unknown } = JSON.parse(
    await blob.text(),
  );
  // Scanner summaries update before the final verdict. Never combine an old
  // raw report with a newer scanner result while a rescan is being committed.
  if (
    stored.checkedAt !== version.llmAnalysis?.checkedAt ||
    stored.checkedAt !== version.aigAnalysis?.checkedAt ||
    stored.checkedAt !== version.skillSpectorAnalysis?.checkedAt
  ) {
    return unavailable;
  }
  return { aig: stored.aig, skillspector: stored.skillspector };
}
