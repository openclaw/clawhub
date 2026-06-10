import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { BrowseSidebar } from "../../components/BrowseSidebar";
import { SKILL_CATEGORIES } from "../../lib/categories";
import { parseDir, parseSort } from "./-params";
import { SkillsResults } from "./-SkillsResults";
import {
  normalizeSkillsView,
  useSkillsBrowseModel,
  type SkillsSearchState,
} from "./-useSkillsBrowseModel";

const BROWSE_SORT_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "downloads", label: "Most downloaded" },
  { value: "stars", label: "Most starred" },
  { value: "installs", label: "Most installed" },
  { value: "updated", label: "Recently updated" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name" },
];

const SEARCH_SORT_OPTIONS = [
  { value: "downloads", label: "Most downloaded" },
  { value: "stars", label: "Most starred" },
  { value: "installs", label: "Most installed" },
  { value: "updated", label: "Recently updated" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name" },
];

const SKILL_CATEGORY_SLUGS = new Set(SKILL_CATEGORIES.map((category) => category.slug));

function parseSkillCategorySlug(value: unknown) {
  return typeof value === "string" && SKILL_CATEGORY_SLUGS.has(value) ? value : undefined;
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
      view: normalizeSkillsView(search.view),
      focus: search.focus === "search" ? "search" : undefined,
    };
  },
  component: SkillsIndex,
});

export function SkillsIndex() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const model = useSkillsBrowseModel({
    navigate,
    search,
    searchInputRef,
  });

  const sortOptionsWithRelevance = model.hasQuery
    ? [{ value: "relevance", label: "Relevance" }, ...SEARCH_SORT_OPTIONS]
    : BROWSE_SORT_OPTIONS;
  const hasActiveFilters = model.hasQuery || Boolean(model.activeCategory) || model.featuredOnly;

  const handleSortChange = useCallback(
    (value: string) => {
      if (value === "featured") {
        if (!model.featuredOnly) model.onToggleFeatured();
        return;
      }

      if (model.featuredOnly) {
        const nextSort = parseSort(value);
        void navigate({
          search: (prev: SkillsSearchState) => {
            const reusePreviousDir =
              prev.sort !== undefined &&
              prev.sort !== "recommended" &&
              prev.sort !== "default" &&
              prev.sort !== "relevance";
            return {
              ...prev,
              sort: nextSort,
              dir:
                nextSort === "recommended" || nextSort === "default"
                  ? undefined
                  : parseDir(reusePreviousDir ? prev.dir : undefined, nextSort),
              featured: undefined,
              highlighted: undefined,
            };
          },
          replace: true,
        });
        return;
      }

      model.onSortChange(value);
    },
    [model.featuredOnly, model.onSortChange, model.onToggleFeatured, navigate],
  );

  const handleClear = useCallback(() => {
    model.onClearFilters();
  }, [model.onClearFilters]);

  const handleCategoryChange = useCallback(
    (slug: string | undefined) => {
      const category = parseSkillCategorySlug(slug);
      void navigate({
        search: (prev: SkillsSearchState) => ({
          ...prev,
          category,
          featured: undefined,
          highlighted: undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  return (
    <main className="browse-page">
      <div className="browse-page-header">
        <button
          className="browse-sidebar-toggle"
          type="button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle filters"
        >
          Filters
        </button>
        <h1 className="browse-title">Skills</h1>
        <div className="browse-view-toggle">
          <button
            className={`browse-view-btn${model.view === "list" ? " is-active" : ""}`}
            type="button"
            onClick={model.view === "grid" ? model.onToggleView : undefined}
          >
            List
          </button>
          <button
            className={`browse-view-btn${model.view === "grid" ? " is-active" : ""}`}
            type="button"
            onClick={model.view === "list" ? model.onToggleView : undefined}
          >
            Grid
          </button>
        </div>
      </div>
      <div className="browse-page-search">
        <Search size={15} className="navbar-search-icon" aria-hidden="true" />
        <input
          ref={searchInputRef}
          className="browse-search-input"
          aria-label="Search skills"
          value={model.query}
          onChange={(event) => model.onQueryChange(event.target.value)}
          placeholder="Search skills..."
        />
      </div>
      <div className={`browse-layout${sidebarOpen ? " sidebar-open" : ""}`}>
        <BrowseSidebar
          categories={SKILL_CATEGORIES}
          activeCategory={model.activeCategory}
          onCategoryChange={handleCategoryChange}
          sortOptions={[{ value: "featured", label: "Featured" }, ...sortOptionsWithRelevance]}
          activeSort={model.featuredOnly ? "featured" : model.sort}
          onSortChange={handleSortChange}
        />
        <div className="browse-results">
          {hasActiveFilters ? (
            <div className="browse-results-toolbar">
              <span className="browse-results-count">
                <button className="browse-clear-btn" type="button" onClick={handleClear}>
                  Clear
                </button>
              </span>
            </div>
          ) : null}
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
