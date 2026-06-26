import { createFileRoute, Link } from "@tanstack/react-router";
import { usePaginatedQuery, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { collectAttentionItems } from "../components/dashboard/dashboardAttention";
import {
  computeDashboardStats,
  excludeAttentionItems,
  filterByAttention,
  filterByKind,
  mergeDashboardItems,
  searchDashboardItems,
  sortDashboardItems,
} from "../components/dashboard/dashboardCatalog";
import { DashboardCatalogView } from "../components/dashboard/DashboardCatalogView";
import { DashboardDownloadsInsights } from "../components/dashboard/DashboardDownloadsInsights";
import { DashboardHeader } from "../components/dashboard/DashboardHeader";
import { DashboardInventorySection } from "../components/dashboard/DashboardInventorySection";
import { DashboardNeedsAttention } from "../components/dashboard/DashboardNeedsAttention";
import { DashboardPublisherSelect } from "../components/dashboard/DashboardPublisherSelect";
import { DashboardRightSidebar } from "../components/dashboard/DashboardRightSidebar";
import { DashboardToolbar } from "../components/dashboard/DashboardToolbar";
import { DashboardWelcome } from "../components/dashboard/DashboardWelcome";
import type {
  DashboardKindFilter,
  DashboardPackage,
  DashboardPublisherEntry,
  DashboardSkill,
  DashboardSortKey,
  DashboardView,
} from "../components/dashboard/types";
import { SignInPrompt } from "../components/SignInPrompt";
import { DashboardSkeleton } from "../components/skeletons/DashboardSkeleton";
import { Button } from "../components/ui/button";
import { TooltipProvider } from "../components/ui/tooltip";
import { addSearchParams } from "../lib/addRoutes";
import {
  dashboardSearchParams,
  parseDashboardSearch,
  type DashboardSearchState,
} from "../lib/dashboardSearch";
import { useAuthStatus } from "../lib/useAuthStatus";

/** Matches `packages.list` server cap; plugins are not paginated on the dashboard yet. */
const DASHBOARD_PACKAGES_LIMIT = 100;
const DASHBOARD_LOAD_TIMEOUT_MS = 20_000;

const DEFAULT_SORT_DIR = {
  name: "asc",
  installs: "desc",
  updated: "desc",
} as const;

export const Route = createFileRoute("/dashboard")({
  validateSearch: (search) => parseDashboardSearch(search),
  component: Dashboard,
});

export function Dashboard() {
  const { isAuthenticated, isLoading: isAuthLoading, me } = useAuthStatus();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const kindFilter: DashboardKindFilter = search.kind ?? "all";
  const query = search.q ?? "";
  const sort: DashboardSortKey = search.sort ?? "updated";
  const view: DashboardView = search.view ?? "list";

  const publishers = useQuery(api.publishers.listMine, me ? {} : "skip") as
    | DashboardPublisherEntry[]
    | undefined;
  const [selectedPublisherId, setSelectedPublisherId] = useState<string>("");
  const [loadTimedOut, setLoadTimedOut] = useState(false);

  const patchSearch = (patch: Partial<DashboardSearchState>) => {
    void navigate({
      to: "/dashboard",
      search: dashboardSearchParams({ ...search, ...patch }),
      resetScroll: false,
    });
  };

  const defaultPublisher =
    publishers?.find((entry) => entry.publisher?.kind === "user") ??
    publishers?.find((entry) => entry.publisher) ??
    null;
  const selectedPublisherFromState = selectedPublisherId
    ? (publishers?.find((entry) => entry.publisher?._id === selectedPublisherId) ?? null)
    : null;
  const selectedPublisher = selectedPublisherFromState ?? defaultPublisher ?? null;
  const activePublisherId = selectedPublisher?.publisher?._id ?? "";
  const canManage = selectedPublisher?.role !== "publisher";

  const skillsQueryArgs =
    selectedPublisher?.publisher?.kind === "user" && me?._id
      ? { ownerUserId: me._id }
      : activePublisherId
        ? { ownerPublisherId: activePublisherId as Doc<"publishers">["_id"] }
        : me?._id
          ? { ownerUserId: me._id }
          : "skip";
  const {
    results: paginatedSkills,
    status: skillsStatus,
    loadMore,
  } = usePaginatedQuery(api.skills.listDashboardPaginated, skillsQueryArgs, {
    initialNumItems: 50,
  });
  const mySkills = paginatedSkills as DashboardSkill[] | undefined;
  const myPackages = useQuery(
    api.packages.list,
    activePublisherId
      ? {
          ownerPublisherId: activePublisherId as Doc<"publishers">["_id"],
          limit: DASHBOARD_PACKAGES_LIMIT,
        }
      : me?._id
        ? { ownerUserId: me._id, limit: DASHBOARD_PACKAGES_LIMIT }
        : "skip",
  ) as DashboardPackage[] | undefined;

  const skills = mySkills ?? [];
  const packages = myPackages ?? [];
  const ownerHandle =
    selectedPublisher?.publisher?.handle ??
    me?.handle ??
    me?.name ??
    me?.displayName ??
    me?._id ??
    "publisher";
  const aggregateStats = useMemo(
    () => computeDashboardStats(skills, packages, ownerHandle),
    [skills, packages, ownerHandle],
  );
  const attentionItems = useMemo(
    () => collectAttentionItems(skills, packages, ownerHandle),
    [skills, packages, ownerHandle],
  );
  const catalogItems = useMemo(() => {
    const merged = mergeDashboardItems(skills, packages);
    const byKind = filterByKind(merged, kindFilter);
    const showAttentionStrip = kindFilter !== "attention" && attentionItems.length > 0;
    const afterAttention =
      kindFilter === "attention"
        ? filterByAttention(byKind, attentionItems)
        : showAttentionStrip
          ? excludeAttentionItems(byKind, attentionItems)
          : byKind;
    const bySearch = searchDashboardItems(afterAttention, query);
    return sortDashboardItems(bySearch, sort, DEFAULT_SORT_DIR[sort]);
  }, [skills, packages, kindFilter, query, sort, attentionItems]);

  const skillsQuerySkipped = skillsQueryArgs === "skip";
  const packagesQuerySkipped = !activePublisherId && !me?._id;
  const isLoading =
    (!skillsQuerySkipped && skillsStatus === "LoadingFirstPage") ||
    (!packagesQuerySkipped && myPackages === undefined);
  const resolvedPublishers = publishers ?? [];
  const isDashboardEmpty = !isLoading && skills.length === 0 && packages.length === 0;
  const hasQuery = query.trim().length > 0;
  const showLoadMore =
    kindFilter !== "plugin" &&
    kindFilter !== "attention" &&
    skills.length > 0 &&
    skillsStatus === "CanLoadMore";
  const showAttentionStrip = kindFilter !== "attention" && attentionItems.length > 0;
  const skillDownloadsTotal = skills.reduce((sum, skill) => sum + (skill.stats?.downloads ?? 0), 0);
  const pluginDownloadsTotal = packages.reduce((sum, pkg) => sum + (pkg.stats.downloads ?? 0), 0);
  const showDownloadInsights = skillDownloadsTotal + pluginDownloadsTotal > 0;

  useEffect(() => {
    if (!isLoading) {
      setLoadTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setLoadTimedOut(true), DASHBOARD_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  if (isAuthLoading) {
    return <DashboardSkeleton />;
  }

  if (!isAuthenticated || !me) {
    return <SignInPrompt title="Sign in to access your dashboard." />;
  }

  const publisherSelector =
    resolvedPublishers.length > 1 ? (
      <div className="dashboard-welcome-publisher-control">
        <span className="dashboard-welcome-publisher-label">Viewing as</span>
        <DashboardPublisherSelect
          publishers={resolvedPublishers}
          value={activePublisherId}
          onValueChange={setSelectedPublisherId}
          triggerClassName="dashboard-welcome-publisher-trigger"
        />
      </div>
    ) : null;

  if (isLoading && !loadTimedOut) {
    return <DashboardSkeleton />;
  }

  if (loadTimedOut && isLoading) {
    return (
      <main className="browse-page browse-page-borderless-header dashboard-route">
        <DashboardLoadError onRetry={() => window.location.reload()} />
      </main>
    );
  }

  if (isDashboardEmpty) {
    return <DashboardWelcome ownerHandle={ownerHandle} publisherSelector={publisherSelector} />;
  }

  const headerPublisher = selectedPublisher?.publisher ?? {
    _id: activePublisherId || me._id,
    handle: ownerHandle,
    displayName: me.displayName ?? me.name ?? ownerHandle,
    kind: "user" as const,
  };

  return (
    <TooltipProvider>
      <main className="browse-page browse-page-borderless-header dashboard-route">
        <DashboardHeader
          publisher={headerPublisher}
          publishers={resolvedPublishers}
          activePublisherId={activePublisherId}
          onPublisherChange={setSelectedPublisherId}
          ownerHandle={ownerHandle}
        />

        <div className="dashboard-workspace">
          <div className="dashboard-workspace-main">
            {showAttentionStrip ? <DashboardNeedsAttention items={attentionItems} /> : null}

            <DashboardInventorySection
              toolbar={
                <DashboardToolbar
                  kind={kindFilter}
                  query={query}
                  sort={sort}
                  view={view}
                  stats={aggregateStats}
                  onKindChange={(kind) => patchSearch({ kind })}
                  onQueryChange={(q) => patchSearch({ q: q.trim() ? q : undefined })}
                  onSortChange={(nextSort) => patchSearch({ sort: nextSort })}
                  onViewChange={(nextView) => patchSearch({ view: nextView })}
                />
              }
            >
              {catalogItems.length > 0 ? (
                <>
                  <DashboardCatalogView
                    items={catalogItems}
                    view={view}
                    ownerHandle={ownerHandle}
                    canManage={canManage}
                  />
                  {showLoadMore ? (
                    <div className="dashboard-footer-row">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => loadMore(50)}
                      >
                        Load more
                      </Button>
                    </div>
                  ) : null}
                  {skillsStatus === "LoadingMore" ? (
                    <div className="dashboard-footer-row flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span>Loading more…</span>
                    </div>
                  ) : null}
                </>
              ) : (
                <CatalogEmpty
                  hasQuery={hasQuery}
                  kind={kindFilter}
                  query={query}
                  ownerHandle={ownerHandle}
                  attentionCount={attentionItems.length}
                />
              )}
            </DashboardInventorySection>
          </div>

          <DashboardRightSidebar ownerHandle={ownerHandle} />

          {showDownloadInsights ? (
            <DashboardDownloadsInsights
              skills={skills}
              packages={packages}
              skillDownloadsTotal={skillDownloadsTotal}
              pluginDownloadsTotal={pluginDownloadsTotal}
              insight={search.insight}
              onInsightChange={(insight) => patchSearch({ insight })}
            />
          ) : null}
        </div>
      </main>
    </TooltipProvider>
  );
}

function DashboardLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">Couldn't load your dashboard</p>
      <p className="empty-state-body">Check your connection and try again.</p>
      <Button type="button" size="sm" className="mt-4" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function CatalogEmpty({
  hasQuery,
  kind,
  query,
  ownerHandle,
  attentionCount,
}: {
  hasQuery: boolean;
  kind: DashboardKindFilter;
  query: string;
  ownerHandle: string;
  attentionCount: number;
}) {
  if (hasQuery) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">No matches for “{query.trim()}”</p>
        <p className="empty-state-body">Try a different name, or clear the search.</p>
      </div>
    );
  }

  if (kind === "attention") {
    return (
      <div className="empty-state">
        <p className="empty-state-title">
          {attentionCount === 0 ? "Nothing needs attention" : "No attention items match"}
        </p>
        <p className="empty-state-body">
          {attentionCount === 0
            ? "Skills and plugins with security, visibility, or validation issues appear here."
            : "Clear filters or switch tabs to see the full catalog."}
        </p>
        {attentionCount === 0 ? (
          <Button asChild size="sm" className="mt-4" variant="outline">
            <Link to="/dashboard" search={dashboardSearchParams({ kind: "all" })}>
              View all items
            </Link>
          </Button>
        ) : null}
      </div>
    );
  }

  const isPlugin = kind === "plugin";
  return (
    <div className="empty-state">
      <p className="empty-state-title">{isPlugin ? "No plugins yet" : "No skills yet"}</p>
      <p className="empty-state-body">
        {isPlugin
          ? "Publish your first plugin release to validate and distribute it."
          : "Publish your first skill to share it with the community."}
      </p>
      <Button asChild size="sm" className="mt-4">
        <Link
          to="/add"
          search={addSearchParams({
            kind: isPlugin ? "plugin" : "skill",
            ownerHandle,
          })}
        >
          {isPlugin ? "Add plugin" : "Add skill"}
        </Link>
      </Button>
    </div>
  );
}
