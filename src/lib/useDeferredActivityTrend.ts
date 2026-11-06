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

function useDeferredActivityTrend(
  kind: "skill" | "package",
  name: string | null,
  endDay: number | null,
  ownerHandle?: string,
): DeferredActivityTrendResult {
  const convex = useConvex();
  const key =
    name && endDay !== null
      ? kind === "skill"
        ? `skill:${name}:${ownerHandle ?? ""}:${endDay}`
        : `package:${name}:${endDay}`
      : null;
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
      const request =
        kind === "skill"
          ? convex.query(
              getSkillActivityTrendForSlug,
              ownerHandle ? { slug: name, ownerHandle, endDay } : { slug: name, endDay },
            )
          : convex.query(getPackageActivityTrendForName, { name, endDay });
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
  }, [convex, endDay, key, kind, name, ownerHandle]);

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
  return useDeferredActivityTrend(
    "skill",
    params?.slug ?? null,
    params?.endDay ?? null,
    params?.ownerHandle,
  );
}

export function useDeferredPackageActivityTrend(
  params: {
    name: string;
    endDay: number;
  } | null,
): DeferredActivityTrendResult {
  return useDeferredActivityTrend("package", params?.name ?? null, params?.endDay ?? null);
}
