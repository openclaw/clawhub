import { createFileRoute } from "@tanstack/react-router";
import { ConvexHttpClient } from "convex/browser";
import { useQuery } from "convex/react";
import { useCallback, useRef } from "react";
import { api } from "../../../convex/_generated/api";
import {
  BrowseCategorySelect,
  BrowseCategorySidebar,
  BrowseControls,
  BrowseSearchInput,
  BrowseTopicChips,
} from "../../components/BrowseControls";
import { convexHttp } from "../../convex/client";
import { formatBrowseCount } from "../../lib/browseCount";
import {
  parseBrowseTopicFromSearchInput,
  sanitizeBrowseTopicSearch,
} from "../../lib/browseTopicSearch";
import { resolveSkillBrowseCategorySlug, SKILL_CATEGORIES } from "../../lib/categories";
import {
  consumeManualCatalogSearch,
  takeManualCatalogSearch,
  type ManualCatalogSearch,
} from "../../lib/manualCatalogSearch";
import { fetchSkillSearch } from "../../lib/skillSearchApi";
import { useBrowseTopicSearch } from "../../lib/useBrowseTopicSearch";
import { parseSort } from "./-params";
import { SkillsResults } from "./-SkillsResults";
import type { SkillSearchEntry } from "./-types";
import {
  buildSkillsSearchKey,
  buildSkillsBrowseArgs,
  buildSkillsBrowseKey,
  type InitialSkillsListData,
  type InitialSkillsSearchData,
  useSkillsBrowseModel,
  type SkillsSearchState,
} from "./-useSkillsBrowseModel";

const SKILLS_INITIAL_SEARCH_LIMIT = 25;
export const SKILLS_INITIAL_PAGE_TIMEOUT_MS = 250;

type InitialSkillsLoaderData = InitialSkillsSearchData | InitialSkillsListData;

function parseSkillCategorySlug(value: unknown) {
  return typeof value === "string" ? resolveSkillBrowseCategorySlug(value) : undefined;
}

export const Route = createFileRoute("/skills/")({
  validateSearch: (search): SkillsSearchState => {
    const category = parseSkillCategorySlug(search.category);
    const topic = parseBrowseTopicFromSearchInput(search as Record<string, unknown>);
    const sort =
      typeof search.sort === "string" && search.sort !== "trending"
        ? parseSort(search.sort)
        : undefined;
    return {
      q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
      sort,
      dir: search.dir === "asc" || search.dir === "desc" ? search.dir : undefined,
      category,
      topic,
      focus: search.focus === "search" ? "search" : undefined,
    };
  },
  loaderDeps: ({ search }) => {
    const hasQuery = Boolean(search.q?.trim());
    return {
      q: search.q,
      category: search.category,
      topic: search.topic,
      sort: hasQuery ? undefined : search.sort,
      dir: hasQuery ? undefined : search.dir,
    };
  },
  beforeLoad: ({ search, preload }) => ({
    manualCatalogSearch: preload ? null : takeManualCatalogSearch(search.q),
  }),
  loader: async ({ deps, abortController, context }): Promise<InitialSkillsLoaderData> =>
    !deps.q?.trim()
      ? await loadInitialSkillsDataWithinBudget(deps, abortController.signal)
      : await loadInitialSkillsData(deps, abortController.signal, context?.manualCatalogSearch),
  component: SkillsIndex,
});

export async function loadInitialSkillsData(
  search: SkillsSearchState,
  signal?: AbortSignal,
  manualCatalogSearch?: ManualCatalogSearch | null,
): Promise<InitialSkillsLoaderData> {
  const query = search.q?.trim();
  if (query) {
    const featuredOnly = false;
    const key = buildSkillsSearchKey({
      query,
      featuredOnly,
      categorySlug: search.category,
      topic: search.topic,
    });
    try {
      const args = {
        query,
        highlightedOnly: featuredOnly,
        categorySlug: search.category,
        topic: search.topic,
        limit: SKILLS_INITIAL_SEARCH_LIMIT,
      };
      const results = consumeManualCatalogSearch(manualCatalogSearch, "skill", query)
        ? ((await fetchSkillSearch({
            ...args,
            searchSource: "clawhub-web",
            signal,
          })) as SkillSearchEntry[])
        : ((await convexHttp.action(api.search.searchSkills, args)) as SkillSearchEntry[]);
      return { key, limit: SKILLS_INITIAL_SEARCH_LIMIT, results };
    } catch (error) {
      console.error("Failed to load initial skills search:", error);
      return null;
    }
  }

  try {
    // Keep timeout/navigation cancellation scoped to this request, never the shared client.
    const client = signal
      ? new ConvexHttpClient(convexHttp.url, {
          fetch: (input, init) => fetch(input, { ...init, signal }),
        })
      : convexHttp;
    const result = await client.query(api.skills.listPublicPageV4, buildSkillsBrowseArgs(search));
    signal?.throwIfAborted();
    // Let the client continue filtered scans instead of hydrating an empty transport page.
    if (result.page.length === 0 && result.hasMore) return null;
    return {
      kind: "browse",
      key: buildSkillsBrowseKey(search),
      results: result.page,
      nextCursor: result.hasMore ? result.nextCursor : null,
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error("Failed to load initial skills page:", error);
    return null;
  }
}

async function loadInitialSkillsDataWithinBudget(
  search: SkillsSearchState,
  navigationSignal: AbortSignal,
): Promise<InitialSkillsLoaderData> {
  if (navigationSignal.aborted) throw navigationSignal.reason;

  const requestController = new AbortController();
  let rejectOnNavigationAbort: (reason: unknown) => void = () => {};
  const navigationAbort = new Promise<never>((_, reject) => {
    rejectOnNavigationAbort = reject;
  });
  const abortFromNavigation = () => {
    requestController.abort(navigationSignal.reason);
    rejectOnNavigationAbort(navigationSignal.reason);
  };
  navigationSignal.addEventListener("abort", abortFromNavigation, { once: true });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve(null);
      requestController.abort(
        new DOMException("Initial Skills catalog request timed out", "TimeoutError"),
      );
    }, SKILLS_INITIAL_PAGE_TIMEOUT_MS);
  });

  try {
    // Slow catalog dependencies must not hold the document response open.
    // Hydration falls back to the existing client fetch after this budget.
    return await Promise.race([
      loadInitialSkillsData(search, requestController.signal),
      timeout,
      navigationAbort,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    navigationSignal.removeEventListener("abort", abortFromNavigation);
  }
}

export function SkillsIndex() {
  const navigate = Route.useNavigate();
  const routeSearch = Route.useSearch();
  const initialData = Route.useLoaderData() as InitialSkillsLoaderData | undefined;
  const initialList = initialData && "kind" in initialData ? initialData : undefined;
  const initialSearch = initialData && !("kind" in initialData) ? initialData : undefined;
  const { search, activeTopic } = useBrowseTopicSearch(routeSearch, navigate);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const model = useSkillsBrowseModel({
    initialList,
    initialSearch,
    navigate,
    search,
    searchInputRef,
  });

  const hasActiveFilters = model.hasQuery || Boolean(model.activeCategory) || Boolean(activeTopic);
  const totalSkillsCount = useQuery(api.skills.countPublicSkills, {});
  const categoryTopics = useQuery(
    api.catalogTopics.listTopByCategory,
    model.activeCategory
      ? {
          kind: "skill",
          category: model.activeCategory,
        }
      : "skip",
  );
  const formattedCount = !hasActiveFilters ? formatBrowseCount(totalSkillsCount) : null;

  const handleCategoryChange = useCallback(
    (slug: string | undefined) => {
      const category = parseSkillCategorySlug(slug);
      void navigate({
        search: (prev: SkillsSearchState) => ({
          ...prev,
          category,
          topic: undefined,
          featured: undefined,
          highlighted: undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const handleTopicChange = useCallback(
    (topic: string | undefined) => {
      void navigate({
        search: (prev: SkillsSearchState) =>
          sanitizeBrowseTopicSearch(
            {
              ...prev,
              featured: undefined,
              highlighted: undefined,
            },
            topic ?? null,
          ),
        replace: true,
      });
    },
    [navigate],
  );

  return (
    <main className="browse-page browse-page-borderless-header skills-browse-page catalog-browse-page">
      <div className="browse-page-header">
        <div className="browse-page-header-main">
          <h1 className="browse-title">
            Skills
            {formattedCount ? (
              <>
                {" "}
                <span className="browse-count">{formattedCount}</span>
              </>
            ) : null}
          </h1>
        </div>
      </div>
      <BrowseControls>
        <BrowseSearchInput
          inputRef={searchInputRef}
          focusShortcut
          label="skill search"
          placeholder="Search skills..."
          value={model.query}
          onChange={model.onQueryChange}
          onClear={model.onClearQuery}
        />
        <BrowseCategorySelect
          categories={SKILL_CATEGORIES}
          value={model.activeCategory}
          onChange={handleCategoryChange}
          responsive
        />
        <BrowseTopicChips
          topics={categoryTopics ?? []}
          activeTopic={activeTopic}
          onChange={handleTopicChange}
          loading={Boolean(model.activeCategory && categoryTopics === undefined)}
        />
      </BrowseControls>
      <div className="browse-layout browse-layout-with-sidebar">
        <BrowseCategorySidebar
          ariaLabel="Skill categories"
          categories={SKILL_CATEGORIES}
          value={model.activeCategory}
          onChange={handleCategoryChange}
        />
        <div className="browse-results">
          {model.searchError ? (
            <p role="alert">Unable to search skills. Refresh to retry.</p>
          ) : (
            <SkillsResults
              isLoadingSkills={model.isLoadingSkills}
              sorted={model.sorted}
              listDoneLoading={!model.isLoadingSkills && !model.canLoadMore && !model.isLoadingMore}
              hasQuery={model.hasQuery}
              canLoadMore={model.canLoadMore}
              isLoadingMore={model.isLoadingMore}
              canAutoLoad={model.canAutoLoad}
              loadMoreRef={model.loadMoreRef}
              loadMore={model.loadMore}
              listFailed={model.listFailed}
              retryLoad={model.retryLoad}
            />
          )}
        </div>
      </div>
    </main>
  );
}
