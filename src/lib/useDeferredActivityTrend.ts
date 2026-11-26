import { useConvex } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { isActivityTrend, type ActivityTrend } from "./activityTrend";

const ACTIVITY_TREND_FALLBACK_DELAY_MS = 750;

type DeferredActivityTrendState = {
  key: string | null;
  loading: boolean;
  trend: ActivityTrend | null;
};

type DeferredActivityTrendResult = {
  loading: boolean;
  trend: ActivityTrend | null;
};

export function useDeferredPackageActivityTrend(
  params: { name: string; endDay: number } | null,
): DeferredActivityTrendResult {
  const convex = useConvex();
  const name = params?.name ?? null;
  const endDay = params?.endDay ?? null;
  const key = name && endDay !== null ? `package:${name}:${endDay}` : null;
  const [state, setState] = useState<DeferredActivityTrendState>({
    key: null,
    loading: false,
    trend: null,
  });

  useEffect(() => {
    if (!name || endDay === null || key === null) {
      setState({ key: null, loading: false, trend: null });
      return () => {};
    }

    let cancelled = false;
    setState({ key, loading: true, trend: null });

    const handle = setTimeout(() => {
      const request = convex.query(api.packages.getActivityTrendForName, { name, endDay });
      void request.then(
        (value) => {
          if (cancelled) return;
          setState({ key, loading: false, trend: isActivityTrend(value) ? value : null });
        },
        () => {
          if (cancelled) return;
          setState({ key, loading: false, trend: null });
        },
      );
    }, ACTIVITY_TREND_FALLBACK_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [convex, endDay, key, name]);

  return {
    loading: key !== null && (state.key !== key || state.loading),
    trend: state.key === key ? state.trend : null,
  };
}
