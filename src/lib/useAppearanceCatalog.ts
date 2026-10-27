import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAppearancePage, type AppearancePage, type AppearanceView } from "./appearance";

export function useAppearanceCatalog(view: AppearanceView, query: string) {
  const [page, setPage] = useState<AppearancePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const request = useCallback(
    async (cursor: string | null) => {
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      setLoading(true);
      setError(null);
      const timer = setTimeout(
        () => controller.abort(new Error("Request timed out. Please retry.")),
        10_000,
      );
      try {
        const next = await Promise.race([
          fetchAppearancePage(view, query, cursor, controller.signal),
          new Promise<never>((_, reject) =>
            controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
              once: true,
            }),
          ),
        ]);
        if (!mounted.current || active.current !== controller) return;
        setPage((previous) => {
          if (!cursor || !previous || previous.kind !== next.kind) return next;
          if (previous.kind === "themes" && next.kind === "themes") {
            const known = new Set(previous.items.map((item) => item.id));
            return {
              ...next,
              items: [...previous.items, ...next.items.filter((item) => !known.has(item.id))],
            };
          }
          if (previous.kind === "packs" && next.kind === "packs") {
            const known = new Set(previous.items.map((item) => item.name));
            return {
              ...next,
              items: [...previous.items, ...next.items.filter((item) => !known.has(item.name))],
            };
          }
          return next;
        });
      } catch (cause) {
        if (mounted.current && active.current === controller)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load appearance items. Please retry.",
          );
      } finally {
        clearTimeout(timer);
        if (mounted.current && active.current === controller) setLoading(false);
      }
    },
    [view, query],
  );
  useEffect(() => {
    mounted.current = true;
    setPage(null);
    void request(null);
    return () => {
      mounted.current = false;
      const controller = active.current;
      active.current = null;
      controller?.abort();
    };
  }, [request]);
  const loadMore = () => {
    if (!loading && page?.nextCursor) void request(page.nextCursor);
  };
  const retry = () => {
    if (!loading) void request(page?.nextCursor ?? null);
  };
  return { page, loading, error, loadMore, retry };
}
