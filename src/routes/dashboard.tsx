import { createFileRoute, Link } from "@tanstack/react-router";
import { usePaginatedQuery, useQuery } from "convex/react";
import { ChevronsUpDown, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { collectAttentionItems } from "../components/dashboard/dashboardAttention";
import {
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
  DashboardCatalogItem,
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
const DASHBOARD_SIDEBAR_STORAGE_KEY = "clawhub.dashboard.sidebar";
const DASHBOARD_VIEW_STORAGE_KEY = "clawhub.dashboard.view";
const DEFAULT_SORT_DIR = {
  name: "asc",
  downloads: "desc",
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
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);

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
    const sorted = sortDashboardItems(bySearch, sort, sort ? DEFAULT_SORT_DIR[sort] : undefined);
    return addVisualCatalogMocks(sorted, {
      kind: kindFilter,
      ownerHandle,
      query,
      sort,
    });
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
    const savedSidebar = window.localStorage.getItem(DASHBOARD_SIDEBAR_STORAGE_KEY);
    if (savedSidebar === "hidden") setIsSidebarVisible(false);

    if (!search.view) {
      const savedView = window.localStorage.getItem(DASHBOARD_VIEW_STORAGE_KEY);
      if (savedView === "list" || savedView === "grid") patchSearch({ view: savedView });
    }
  }, []);

  useEffect(() => {
    if (!isLoading) {
      setLoadTimedOut(false);
      return undefined;
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
          triggerIcon={<ChevronsUpDown className="h-4 w-4 opacity-50" />}
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

  return (
    <TooltipProvider>
      <main
        className={`browse-page browse-page-borderless-header dashboard-route dashboard-final${isSidebarVisible ? "" : " is-dashboard-sidebar-hidden"}`}
      >
        <DashboardHeader
          publishers={resolvedPublishers}
          activePublisherId={activePublisherId}
          onPublisherChange={setSelectedPublisherId}
          ownerHandle={ownerHandle}
          isSidebarVisible={isSidebarVisible}
          onToggleSidebar={() =>
            setIsSidebarVisible((value) => {
              const nextValue = !value;
              window.localStorage.setItem(
                DASHBOARD_SIDEBAR_STORAGE_KEY,
                nextValue ? "visible" : "hidden",
              );
              return nextValue;
            })
          }
        />

        <div
          className={`dashboard-workspace${isSidebarVisible ? "" : " is-sidebar-hidden"}${showAttentionStrip ? "" : " has-no-attention"}`}
        >
          <div className="dashboard-workspace-main">
            {showAttentionStrip ? <DashboardNeedsAttention items={attentionItems} /> : null}

            <DashboardInventorySection
              count={catalogItems.length}
              toolbar={
                <DashboardToolbar
                  kind={kindFilter}
                  query={query}
                  sort={sort}
                  view={view}
                  onKindChange={(kind) => patchSearch({ kind })}
                  onQueryChange={(q) => patchSearch({ q: q.trim() ? q : undefined })}
                  onSortChange={(nextSort) => patchSearch({ sort: nextSort })}
                  onViewChange={(nextView) => {
                    window.localStorage.setItem(DASHBOARD_VIEW_STORAGE_KEY, nextView);
                    patchSearch({ view: nextView });
                  }}
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

            {showDownloadInsights ? (
              <div className="dashboard-downloads-mobile-slot">
                <DashboardDownloadsInsights
                  skills={skills}
                  packages={packages}
                  skillDownloadsTotal={skillDownloadsTotal}
                  pluginDownloadsTotal={pluginDownloadsTotal}
                  insight={search.insight}
                  onInsightChange={(insight) => patchSearch({ insight })}
                />
              </div>
            ) : null}
          </div>

          {isSidebarVisible ? <DashboardRightSidebar ownerHandle={ownerHandle} /> : null}
        </div>

        {showDownloadInsights ? (
          <div className="dashboard-downloads-desktop-slot">
            <DashboardDownloadsInsights
              skills={skills}
              packages={packages}
              skillDownloadsTotal={skillDownloadsTotal}
              pluginDownloadsTotal={pluginDownloadsTotal}
              insight={search.insight}
              onInsightChange={(insight) => patchSearch({ insight })}
            />
          </div>
        ) : null}
      </main>
    </TooltipProvider>
  );
}

function addVisualCatalogMocks(
  items: DashboardCatalogItem[],
  options: {
    kind: DashboardKindFilter;
    ownerHandle: string;
    query: string;
    sort?: DashboardSortKey;
  },
) {
  if (options.kind === "attention" || items.length >= 5) return items;
  const existing = new Set(items.map((item) => `${item.kind}:${item.id}`));
  const mocks = searchDashboardItems(
    filterByKind(buildVisualCatalogMocks(options.ownerHandle), options.kind),
    options.query,
  ).filter((item) => !existing.has(`${item.kind}:${item.id}`));
  const sortedMocks = sortDashboardItems(
    mocks,
    options.sort,
    options.sort ? DEFAULT_SORT_DIR[options.sort] : undefined,
  );
  return [...items, ...sortedMocks.slice(0, 5 - items.length)];
}

function buildVisualCatalogMocks(ownerHandle: string): DashboardCatalogItem[] {
  const now = Date.now();
  const skillBase = {
    _creationTime: now,
    ownerUserId: "users:local",
    ownerPublisherId: "publishers:local",
    ownerPath: ownerHandle,
    canonicalSkillId: null,
    forkOf: null,
    latestVersionId: null,
    tags: {},
    badges: {},
    moderationStatus: "active",
    moderationReason: null,
    moderationSummary: null,
    moderationVerdict: "clean",
    moderationFlags: [],
    isSuspicious: false,
    createdAt: now,
    pendingReview: false,
    qualityDecision: "pass",
    latestVersion: {
      version: "1.0.0",
      createdAt: now,
      vtStatus: "clean",
      llmStatus: "clean",
      staticScanStatus: "clean",
    },
  } satisfies Partial<DashboardSkill>;

  const skills = [
    {
      _id: "visual-skill:workflow-guard",
      slug: "workflow-guard",
      displayName: "Workflow Guard",
      summary: "Review local agent workflows before publishing.",
      categories: ["security"],
      topics: ["workflows", "review"],
      updatedAt: now - 86_400_000,
      stats: { downloads: 184, installsCurrent: 18, installsAllTime: 42, stars: 12, versions: 3 },
    },
    {
      _id: "visual-skill:prompt-hooks-kit",
      slug: "prompt-hooks-kit",
      displayName: "Prompt Hooks Kit",
      summary: "Reusable prompt hook patterns for runtime plugins.",
      categories: ["automation"],
      topics: ["prompts", "hooks"],
      updatedAt: now - 172_800_000,
      stats: { downloads: 136, installsCurrent: 11, installsAllTime: 29, stars: 8, versions: 2 },
    },
    {
      _id: "visual-skill:catalog-review",
      slug: "catalog-review",
      displayName: "Catalog Review Assistant",
      summary: "Checks package metadata, release notes, and changelog copy.",
      categories: ["agents"],
      topics: ["catalog", "publishing"],
      updatedAt: now - 259_200_000,
      stats: { downloads: 92, installsCurrent: 9, installsAllTime: 21, stars: 5, versions: 4 },
    },
  ].map((skill) => ({
    kind: "skill" as const,
    id: skill._id,
    name: skill.displayName,
    searchText: `${skill.displayName} ${skill.slug}`.toLowerCase(),
    data: { ...skillBase, ...skill } as DashboardSkill,
    updatedAt: skill.updatedAt,
    installs: skill.stats.installsAllTime,
    downloads: skill.stats.downloads,
  }));

  const pluginBase = {
    family: "code-plugin",
    channel: "community",
    isOfficial: false,
    sourceRepo: null,
    runtimeId: null,
    latestVersion: "1.0.0",
    inspectorWarningCount: 0,
    updatedAt: now,
    verification: null,
    scanStatus: "clean",
    pendingReview: false,
    latestRelease: {
      version: "1.0.0",
      createdAt: now,
      vtStatus: "clean",
      llmStatus: "clean",
      staticScanStatus: "clean",
    },
  } satisfies Partial<DashboardPackage>;

  const plugins = [
    {
      _id: "visual-plugin:github-importer",
      name: "github-importer",
      displayName: "GitHub Importer",
      summary: "Imports skills from public repositories.",
      categories: ["tools"],
      topics: ["github", "import"],
      stats: { downloads: 221, installs: 37, stars: 14, versions: 5 },
      updatedAt: now - 43_200_000,
    },
    {
      _id: "visual-plugin:runtime-adapter",
      name: "runtime-adapter",
      displayName: "Runtime Adapter",
      summary: "Bridges current prompt hooks into older packages.",
      categories: ["runtime"],
      topics: ["compatibility", "hooks"],
      stats: { downloads: 118, installs: 19, stars: 7, versions: 3 },
      updatedAt: now - 302_400_000,
    },
  ].map((pkg) => ({
    kind: "plugin" as const,
    id: pkg._id,
    name: pkg.displayName,
    searchText: `${pkg.displayName} ${pkg.name}`.toLowerCase(),
    data: { ...pluginBase, ...pkg } as DashboardPackage,
    updatedAt: pkg.updatedAt,
    installs: pkg.stats.installs,
    downloads: pkg.stats.downloads,
  }));

  return [...skills, ...plugins];
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
