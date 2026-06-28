import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useCallback, useRef } from "react";
import { api } from "../../../convex/_generated/api";
import {
  BrowseActions,
  BrowseCategorySelect,
  BrowseControls,
  BrowseControlsDivider,
  BrowseControlsRow,
  BrowseSearchInput,
  BrowseSearchPanel,
  BrowseSearchTrigger,
  BrowseSortSelect,
  BrowseTabs,
  BrowseTopicChips,
  BrowseViewToggle,
  useBrowseSearchDisclosure,
} from "../../components/BrowseControls";
import { convexHttp } from "../../convex/client";
import { formatBrowseCount } from "../../lib/browseCount";
import {
  parseBrowseTopicFromSearchInput,
  sanitizeBrowseTopicSearch,
} from "../../lib/browseTopicSearch";
import { resolveSkillBrowseCategorySlug, SKILL_CATEGORIES } from "../../lib/categories";
import { useBrowseTopicSearch } from "../../lib/useBrowseTopicSearch";
import { parseDir, parseSort } from "./-params";
import { SkillsResults } from "./-SkillsResults";
import type { SkillSearchEntry } from "./-types";
import {
  buildSkillsSearchKey,
  type InitialSkillsSearchData,
  normalizeSkillsView,
  useSkillsBrowseModel,
  type SkillsSearchState,
} from "./-useSkillsBrowseModel";

const SKILLS_VIEW_OPTIONS = [
  { value: "all", label: "All" },
  { value: "trending", label: "Trending" },
  { value: "top", label: "Top" },
  { value: "stars", label: "Most starred" },
  { value: "featured", label: "Featured" },
];

const SKILLS_SORT_OPTIONS = [
  { value: "updated", label: "Recently updated" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name" },
];
const SKILLS_INITIAL_SEARCH_LIMIT = 25;

function parseSkillCategorySlug(value: unknown) {
  return typeof value === "string" ? resolveSkillBrowseCategorySlug(value) : undefined;
}

export const Route = createFileRoute("/skills/")({
  validateSearch: (search): SkillsSearchState => {
    return {
      q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
      sort: typeof search.sort === "string" ? parseSort(search.sort) : undefined,
      dir: search.dir === "asc" || search.dir === "desc" ? search.dir : undefined,
      highlighted:
        search.highlighted === "1" || search.highlighted === "true" || search.highlighted === true
          ? true
          : undefined,
      featured:
        search.featured === "1" || search.featured === "true" || search.featured === true
          ? true
          : undefined,
      category: parseSkillCategorySlug(search.category),
      topic: parseBrowseTopicFromSearchInput(search as Record<string, unknown>),
      view: normalizeSkillsView(search.view),
      focus: search.focus === "search" ? "search" : undefined,
    };
  },
  loaderDeps: ({ search }) => ({
    q: search.q,
    featured: search.featured,
    highlighted: search.highlighted,
    category: search.category,
    topic: search.topic,
  }),
  loader: async ({ deps }): Promise<InitialSkillsSearchData> => await loadInitialSkillsSearch(deps),
  component: SkillsIndex,
});

async function loadInitialSkillsSearch(
  search: SkillsSearchState,
): Promise<InitialSkillsSearchData> {
  const query = search.q?.trim();
  if (!query) return null;

  const featuredOnly = search.featured ?? search.highlighted ?? false;
  const key = buildSkillsSearchKey({
    query,
    featuredOnly,
    categorySlug: search.category,
    topic: search.topic,
  });
  try {
    const results = (await convexHttp.action(api.search.searchSkills, {
      query,
      highlightedOnly: featuredOnly,
      categorySlug: search.category,
      topic: search.topic,
      limit: SKILLS_INITIAL_SEARCH_LIMIT,
    })) as SkillSearchEntry[];
    return { key, limit: SKILLS_INITIAL_SEARCH_LIMIT, results };
  } catch (error) {
    console.error("Failed to load initial skills search:", error);
    return null;
  }
}

export function SkillsIndex() {
  const navigate = Route.useNavigate();
  const routeSearch = Route.useSearch();
  const initialSearch = Route.useLoaderData() as InitialSkillsSearchData | undefined;
  const { search, activeTopic } = useBrowseTopicSearch(routeSearch, navigate);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const model = useSkillsBrowseModel({
    initialSearch,
    navigate,
    search,
    searchInputRef,
  });
  const browseSearch = useBrowseSearchDisclosure({
    value: model.query,
    onClear: model.onClearQuery,
    inputRef: searchInputRef,
  });

  const activeView = model.featuredOnly
    ? "featured"
    : model.sort === "trending"
      ? "trending"
      : model.sort === "downloads"
        ? "top"
        : model.sort === "stars"
          ? "stars"
          : "all";
  const activeSort = ["updated", "newest", "name"].includes(model.sort) ? model.sort : undefined;
  const hasActiveFilters =
    model.hasQuery || Boolean(model.activeCategory) || Boolean(activeTopic) || model.featuredOnly;
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

  const handleViewChange = useCallback(
    (value: string) => {
      void navigate({
        search: (prev: SkillsSearchState) => {
          if (value === "trending") {
            return {
              ...prev,
              sort: "trending",
              dir: "desc",
              featured: undefined,
              highlighted: undefined,
            };
          }
          if (value === "top" || value === "stars") {
            const sort = value === "top" ? "downloads" : "stars";
            return {
              ...prev,
              sort,
              dir: "desc",
              featured: undefined,
              highlighted: undefined,
            };
          }

          if (value === "featured") {
            const sort = parseSort(prev.sort);
            const keepSort = sort === "updated" || sort === "newest" || sort === "name";
            return {
              ...prev,
              sort: keepSort ? sort : undefined,
              dir: keepSort ? parseDir(prev.dir, sort) : undefined,
              featured: true,
              highlighted: undefined,
            };
          }

          return {
            ...prev,
            sort: undefined,
            dir: undefined,
            featured: undefined,
            highlighted: undefined,
          };
        },
        replace: true,
      });
    },
    [navigate],
  );

  const handleSortChange = useCallback(
    (value: string | undefined) => {
      if (!value) {
        void navigate({
          search: (prev: SkillsSearchState) => ({
            ...prev,
            sort: undefined,
            dir: undefined,
            featured: activeView === "featured" ? true : undefined,
            highlighted: undefined,
          }),
          replace: true,
        });
        return;
      }
      model.onSortChange(value);
    },
    [activeView, model.onSortChange, navigate],
  );

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
    <main className="browse-page browse-page-borderless-header">
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
        <BrowseControlsRow>
          <BrowseTabs
            ariaLabel="Skill view"
            options={SKILLS_VIEW_OPTIONS}
            value={activeView}
            onChange={(value) => {
              if (value) handleViewChange(value);
            }}
          />
          <BrowseControlsDivider />
          <BrowseSortSelect
            options={SKILLS_SORT_OPTIONS}
            value={activeSort}
            onChange={handleSortChange}
          />
          <BrowseActions>
            <BrowseSearchTrigger
              open={browseSearch.open}
              onOpen={browseSearch.openSearch}
              label="Search skills"
            />
            <BrowseCategorySelect
              categories={SKILL_CATEGORIES}
              value={model.activeCategory}
              onChange={handleCategoryChange}
            />
            <BrowseViewToggle view={model.view} onToggle={model.onToggleView} />
          </BrowseActions>
          <BrowseSearchPanel open={browseSearch.open}>
            <BrowseSearchInput
              inputRef={searchInputRef}
              label="skill search"
              placeholder="Search skills..."
              value={model.query}
              onChange={model.onQueryChange}
              onClear={browseSearch.closeSearch}
              closeLabel="Close search"
            />
          </BrowseSearchPanel>
        </BrowseControlsRow>
        <BrowseTopicChips
          topics={categoryTopics ?? []}
          activeTopic={activeTopic}
          onChange={handleTopicChange}
        />
      </BrowseControls>
      <div className="browse-layout">
        <div className="browse-results">
          <SkillsResults
            isLoadingSkills={model.isLoadingSkills}
            sorted={model.sorted}
            view={model.view}
            listDoneLoading={!model.isLoadingSkills && !model.canLoadMore && !model.isLoadingMore}
            hasQuery={model.hasQuery}
            canLoadMore={model.canLoadMore}
            isLoadingMore={model.isLoadingMore}
            canAutoLoad={model.canAutoLoad}
            loadMoreRef={model.loadMoreRef}
            loadMore={model.loadMore}
          />
        </div>
      </div>
    </main>
  );
}
