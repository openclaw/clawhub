import { useConvex } from "convex/react";
import { useEffect, useState } from "react";
import {
  getPackageActivityTrendForName,
  getSkillActivityTrendForSlug,
  isActivityTrend,
  type ActivityTrend,
} from "./activityTrend";

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

function scheduleDeferredActivityTrend(load: () => void) {
  const handle = setTimeout(load, ACTIVITY_TREND_FALLBACK_DELAY_MS);
  return () => clearTimeout(handle);
}

function resultForState(key: string | null, state: DeferredActivityTrendState) {
  return {
    loading: key !== null && (state.key !== key || state.loading),
    trend: state.key === key ? state.trend : null,
  };
}

export function useDeferredSkillActivityTrend(
  params: {
    slug: string;
    ownerHandle?: string;
    endDay: number;
  } | null,
): DeferredActivityTrendResult {
  const convex = useConvex();
  const slug = params?.slug ?? null;
  const ownerHandle = params?.ownerHandle;
  const endDay = params?.endDay ?? null;
  const key = slug && endDay !== null ? `skill:${slug}:${ownerHandle ?? ""}:${endDay}` : null;
  const [state, setState] = useState<DeferredActivityTrendState>({
    key: null,
    loading: false,
    trend: null,
  });

  useEffect(() => {
    if (!slug || endDay === null || key === null) {
      setState({ key: null, loading: false, trend: null });
      return () => {};
    }

    let cancelled = false;
    setState({ key, loading: true, trend: null });

    const cancelSchedule = scheduleDeferredActivityTrend(() => {
      const args = ownerHandle ? { slug, ownerHandle, endDay } : { slug, endDay };
      void convex.query(getSkillActivityTrendForSlug, args).then(
        (value) => {
          if (cancelled) return;
          setState({ key, loading: false, trend: isActivityTrend(value) ? value : null });
        },
        () => {
          if (cancelled) return;
          setState({ key, loading: false, trend: null });
        },
      );
    });

    return () => {
      cancelled = true;
      cancelSchedule();
    };
  }, [convex, endDay, key, ownerHandle, slug]);

  return resultForState(key, state);
}

export function useDeferredPackageActivityTrend(
  params: {
    name: string;
    endDay: number;
  } | null,
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

    const cancelSchedule = scheduleDeferredActivityTrend(() => {
      void convex.query(getPackageActivityTrendForName, { name, endDay }).then(
        (value) => {
          if (cancelled) return;
          setState({ key, loading: false, trend: isActivityTrend(value) ? value : null });
        },
        () => {
          if (cancelled) return;
          setState({ key, loading: false, trend: null });
        },
      );
    });

    return () => {
      cancelled = true;
      cancelSchedule();
    };
  }, [convex, endDay, key, name]);

  return resultForState(key, state);
}
