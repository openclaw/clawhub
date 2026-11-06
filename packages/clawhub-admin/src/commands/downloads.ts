import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import { apiRequest } from "../../../clawhub/src/http.js";
import { DownloadAnalyticsSummarySchema } from "../../../schema/src/downloadAnalytics.js";

export async function cmdDownloads(
  opts: GlobalOpts,
  options: { json?: boolean; refresh?: boolean },
) {
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const result = await apiRequest(
    registry,
    {
      method: options.refresh ? "POST" : "GET",
      path: "/api/v1/admin/download-analytics",
      token,
    },
    DownloadAnalyticsSummarySchema,
  );
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  const time = Date.now();
  const stale = result.staleAfterAt !== null && time >= result.staleAfterAt;
  const expired = result.refreshExpiresAt !== null && time >= result.refreshExpiresAt;
  const lines = [
    "Template recorded downloads — public, undeleted listings",
    "Status: " + result.status + (stale ? " (STALE)" : ""),
    "Last 24 hours: " +
      (result.downloadsLast24h === null
        ? "not available"
        : result.downloadsLast24h.toLocaleString("en-US")),
    "Lifetime recorded downloads: " +
      (result.downloadsAllTime === null
        ? "not available"
        : result.downloadsAllTime.toLocaleString("en-US")),
  ];
  if (result.windowStartAt !== null && result.windowEndAt !== null)
    lines.push(
      "Rolling window: [" +
        new Date(result.windowStartAt).toISOString() +
        ", " +
        new Date(result.windowEndAt).toISOString() +
        ")",
    );
  if (result.generatedAt !== null)
    lines.push("Generated: " + new Date(result.generatedAt).toISOString());
  if (result.countingPaused)
    lines.push("Counting: PAUSED — archive serving continues; paused downloads are not recorded.");
  if (result.refreshInProgress)
    lines.push(
      expired
        ? "Refresh lease expired; retry --refresh."
        : "Refresh pending; run downloads again to read the completed report.",
    );
  if (result.lastError) lines.push("Refresh error: " + result.lastError);
  lines.push(
    "Recorded downloads are UTC-day deduplicated, not installations or unique people.",
    result.eligibilityNote,
    result.counterLagNote,
    result.consistencyNote,
  );
  process.stdout.write(lines.join("\n") + "\n");
}
