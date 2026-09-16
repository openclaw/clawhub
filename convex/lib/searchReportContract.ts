import { v, type Infer } from "convex/values";
import { searchInsightArgs, SEARCH_DAY_MS } from "./searchInsights";

export const REPORT_VERSION = "search-report-v1" as const;
export const REPORT_TTL_MS = SEARCH_DAY_MS;
export const REPORT_CHUNK_BYTES = 256 * 1024;
export const REPORT_MAX_CHUNKS = 8;
export const reportRequest = v.object({
  view: v.union(v.literal("demand"), v.literal("recommendations")),
  artifactKind: searchInsightArgs.artifactKind,
  scope: searchInsightArgs.scope,
  source: searchInsightArgs.source,
  window: searchInsightArgs.window,
  endDay: searchInsightArgs.endDay,
  limit: searchInsightArgs.limit,
  officialGap: searchInsightArgs.officialGap,
  intentKind: searchInsightArgs.intentKind,
  refreshOf: v.optional(v.string()),
});
export type ReportRequest = Infer<typeof reportRequest>;

export function normalizeReportRequest(input: ReportRequest, now: number) {
  const limit = input.limit ?? (input.view === "recommendations" ? 20 : 50);
  const endDay = input.endDay ?? Math.floor(now / SEARCH_DAY_MS) * SEARCH_DAY_MS;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid limit");
  if (!Number.isSafeInteger(endDay) || endDay < 0 || endDay % SEARCH_DAY_MS !== 0)
    throw new Error("Invalid endDay");
  if (
    input.view === "recommendations" &&
    (input.officialGap !== undefined || input.intentKind !== undefined)
  )
    throw new Error("Recommendation view does not accept demand-only filters");
  return {
    view: input.view,
    artifactKind: input.artifactKind ?? "plugin",
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.source === undefined ? {} : { source: input.source }),
    window: input.window ?? 7,
    endDay,
    limit,
    ...(input.view === "demand" ? { officialGap: input.officialGap ?? false } : {}),
    ...(input.intentKind === undefined ? {} : { intentKind: input.intentKind }),
  } satisfies ReportRequest;
}
