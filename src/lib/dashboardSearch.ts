import type {
  DashboardKindFilter,
  DashboardSortKey,
  DashboardView,
} from "../components/dashboard/types";

export type DashboardSearchState = {
  kind?: DashboardKindFilter;
  q?: string;
  sort?: DashboardSortKey;
  view?: DashboardView;
  /** `skill:<slug>` or `plugin:<name>` — filters download insights to one catalog item. */
  insight?: string;
};

const INSIGHT_PATTERN = /^(skill|plugin):[^:\s]+$/;

function parseInsightParam(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "all") return undefined;
  return INSIGHT_PATTERN.test(trimmed) ? trimmed : undefined;
}

const KIND_FILTERS = new Set<DashboardKindFilter>(["all", "skill", "plugin", "attention"]);
const SORT_KEYS = new Set<DashboardSortKey>(["name", "installs", "updated"]);
const VIEWS = new Set<DashboardView>(["list", "grid"]);

export function parseDashboardSearch(search: Record<string, unknown>): DashboardSearchState {
  const kind =
    typeof search.kind === "string" && KIND_FILTERS.has(search.kind as DashboardKindFilter)
      ? (search.kind as DashboardKindFilter)
      : undefined;
  const q = typeof search.q === "string" && search.q.trim() ? search.q : undefined;
  const sort =
    typeof search.sort === "string" && SORT_KEYS.has(search.sort as DashboardSortKey)
      ? (search.sort as DashboardSortKey)
      : undefined;
  const view =
    typeof search.view === "string" && VIEWS.has(search.view as DashboardView)
      ? (search.view as DashboardView)
      : undefined;
  const insight = parseInsightParam(search.insight);

  return { kind, q, sort, view, insight };
}

export function dashboardSearchParams(state: DashboardSearchState) {
  return {
    kind: state.kind && state.kind !== "all" ? state.kind : undefined,
    q: state.q,
    sort: state.sort && state.sort !== "updated" ? state.sort : undefined,
    view: state.view && state.view !== "list" ? state.view : undefined,
    insight: state.insight,
  };
}
