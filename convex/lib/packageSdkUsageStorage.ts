import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  failedSdkUsageReport,
  normalizeSdkUsageReport,
  type SdkUsageReport,
} from "./packageSdkUsageContract";

type StoredInventory = {
  inspectorSdkUsageStorageId?: Id<"_storage">;
  inspectorSdkUsage?: SdkUsageReport;
};

/** A report can exceed the 1 MiB document limit even when all relationship rows fit. */
export async function stageSdkUsageReport(
  ctx: Pick<ActionCtx, "storage" | "scheduler">,
  report: SdkUsageReport | undefined,
): Promise<StoredInventory> {
  if (!report) return {};
  let storageId: Id<"_storage"> | undefined;
  try {
    storageId = await ctx.storage.store(
      new Blob([JSON.stringify(report)], { type: "application/json" }),
    );
    // Match the publish-attempt TTL, including abandoned and moderation-blocked attempts.
    await ctx.scheduler.runAfter(
      30 * 24 * 60 * 60 * 1000,
      internal.packageSdkUsage.deleteTemporaryReportInternal,
      { storageId },
    );
    return { inspectorSdkUsageStorageId: storageId };
  } catch {
    if (storageId) await ctx.storage.delete(storageId).catch(() => undefined);
    return {
      inspectorSdkUsage: failedSdkUsageReport("Could not stage the SDK inventory; rescan required"),
    };
  }
}

export function sdkUsageReportStorageId(followup: unknown): Id<"_storage"> | undefined {
  const value =
    followup && typeof followup === "object" && "inspectorSdkUsageStorageId" in followup
      ? followup.inspectorSdkUsageStorageId
      : undefined;
  return typeof value === "string" ? (value as Id<"_storage">) : undefined;
}

export async function readStagedSdkUsageReport(
  ctx: Pick<ActionCtx, "storage">,
  followup: StoredInventory,
): Promise<SdkUsageReport | undefined> {
  if (!followup.inspectorSdkUsageStorageId) return followup.inspectorSdkUsage;
  try {
    const blob = await ctx.storage.get(followup.inspectorSdkUsageStorageId);
    if (blob)
      return (
        normalizeSdkUsageReport(JSON.parse(await blob.text())) ??
        failedSdkUsageReport("Stored SDK inventory is empty")
      );
  } catch {
    // Missing/expired/corrupt inventory must not alter compatibility or publication outcomes.
  }
  return failedSdkUsageReport("Stored SDK inventory is unavailable; rescan required");
}
