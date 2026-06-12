import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Search, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { BrowseSidebar } from "../../components/BrowseSidebar";
import { formatBrowseCount } from "../../lib/browseCount";
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

const FEATURED_SORT_OPTION = { value: "featured", label: "Featured" };
const SKILLS_SORT_OPTIONS = [
  BROWSE_SORT_OPTIONS[0],
  FEATURED_SORT_OPTION,
  ...BROWSE_SORT_OPTIONS.slice(1),
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

  const activeSort = model.featuredOnly
    ? "featured"
    : model.sort === "relevance"
      ? "recommended"
      : model.sort;
  const hasActiveFilters =
    model.hasQuery || Boolean(model.activeCategory) || model.featuredOnly || Boolean(search.tag);
  const totalSkillsCount = useQuery(api.skills.countPublicSkills, {});
  const formattedCount = !hasActiveFilters ? formatBrowseCount(totalSkillsCount) : null;

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
        <h1 className="browse-title">
          Skills
          {formattedCount ? (
            <>
              {" "}
              <span className="browse-count">{formattedCount}</span>
            </>
          ) : null}
        </h1>
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
        {model.query ? (
          <button
            type="button"
            className="browse-search-clear"
            aria-label="Clear skill search"
            onClick={model.onClearQuery}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className={`browse-layout${sidebarOpen ? " sidebar-open" : ""}`}>
        <BrowseSidebar
          categories={SKILL_CATEGORIES}
          activeCategory={model.activeCategory}
          onCategoryChange={handleCategoryChange}
          sortOptions={SKILLS_SORT_OPTIONS}
          activeSort={activeSort}
          onSortChange={handleSortChange}
        />
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
