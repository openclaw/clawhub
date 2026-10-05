import { useEffect, useRef } from "react";
import { captureAnalyticsOperation, safePublicSearchTerm } from "./analyticsEvents";

export function useAnalyticsSearchResults({
  query,
  count,
  loading,
  failed,
  context,
  complete = false,
  filter = "none",
}: {
  query: string | undefined;
  count: number;
  loading: boolean;
  failed: boolean;
  context: "skills" | "plugins" | "all";
  complete?: boolean;
  filter?: "none" | "category" | "topic" | "sort" | "featured" | "multiple";
}) {
  const lastResult = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !safePublicSearchTerm(query)) return undefined;
    const operation = captureAnalyticsOperation();
    if (!operation) return undefined;
    const key = `${context}:${query}:${count}:${complete}:${failed}:${filter}`;
    if (lastResult.current === key) return undefined;
    // Wait for loading effects from this commit, and cancel stale snapshots.
    const timer = window.setTimeout(() => {
      if (
        operation.emit("resource_action", {
          action: "search_results",
          content_type: "search",
          action_result: failed ? "error" : "success",
          search_context: context,
          search_filter: filter,
          ...(!failed && (complete || count > 0) ? { result_count: count } : {}),
          search_status: failed ? "error" : complete ? "complete" : "partial",
        })
      )
        lastResult.current = key;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [query, count, loading, failed, context, complete, filter]);
}
