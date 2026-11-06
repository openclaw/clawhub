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
