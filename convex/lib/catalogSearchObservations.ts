import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import {
  buildCatalogSearchObservation,
  parseCatalogSearchSource,
  type CatalogSearchFacts,
  type SearchInsightSource,
} from "./searchInsights";

export async function recordCatalogSearchObservation(
  ctx: Pick<ActionCtx, "runMutation">,
  request: Request,
  facts: CatalogSearchFacts,
) {
  if (request.signal.aborted) return;
  const source = parseCatalogSearchSource(new URL(request.url).searchParams.get("searchSource"));
  await recordCatalogSearchFacts(ctx, { ...facts, source });
}

export async function recordCatalogSearchFacts(
  ctx: Pick<ActionCtx, "runMutation">,
  facts: CatalogSearchFacts & { source: SearchInsightSource | undefined },
) {
  const observation = buildCatalogSearchObservation(facts);
  if (!observation) return;
  try {
    await ctx.runMutation(internal.pluginSearchObservations.recordInternal, observation);
  } catch {
    // Analytics failure must neither fail search nor disclose a raw query in logs.
    console.error("[catalog-search-observations] failed to record marked search", {
      source: facts.source,
    });
  }
}
