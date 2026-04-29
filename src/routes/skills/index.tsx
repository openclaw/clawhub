import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { BrowseSidebar } from "../../components/BrowseSidebar";
import { SKILL_CATEGORIES } from "../../lib/categories";
import { formatCompactStat } from "../../lib/numberFormat";
import { parseDir, parseSort } from "./-params";
import { SkillsResults } from "./-SkillsResults";
import { useSkillsBrowseModel, type SkillsSearchState } from "./-useSkillsBrowseModel";

const SORT_OPTIONS = [
  { value: "downloads", label: "Most downloaded" },
  { value: "stars", label: "Most starred" },
  { value: "installs", label: "Most installed" },
  { value: "updated", label: "Recently updated" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name" },
];

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
      nonSuspicious:
        search.nonSuspicious === "1" ||
        search.nonSuspicious === "true" ||
        search.nonSuspicious === true
          ? true
          : undefined,
      view: search.view === "cards" || search.view === "list" ? search.view : undefined,
      focus: search.focus === "search" ? "search" : undefined,
    };
  },
  beforeLoad: ({ search }) => {
    const hasQuery = Boolean(search.q?.trim());
    if (hasQuery || search.sort || search.featured || search.highlighted) {
      return;
    }
    throw redirect({
      to: "/skills",
      search: {
        q: search.q || undefined,
        sort: "downloads",
        dir: search.dir || undefined,
        highlighted: search.highlighted || undefined,
        featured: search.featured || undefined,
        nonSuspicious: search.nonSuspicious || undefined,
        view: search.view || undefined,
        focus: search.focus || undefined,
      },
      replace: true,
    });
  },
  component: SkillsIndex,
});

export function SkillsIndex() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const totalSkills = useQuery(api.skills.countPublicSkills);
  const totalSkillsText = typeof totalSkills === "number" ? formatCompactStat(totalSkills) : null;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const model = useSkillsBrowseModel({
    navigate,
    search,
    searchInputRef,
  });

  const sortOptionsWithRelevance = model.hasQuery
    ? [{ value: "relevance", label: "Relevance" }, ...SORT_OPTIONS]
    : SORT_OPTIONS;

  const handleFilterToggle = useCallback(
    (key: string) => {
      if (key === "nonSuspicious") model.onToggleNonSuspicious();
    },
    [model.onToggleNonSuspicious],
  );

  const handleSortChange = useCallback(
    (value: string) => {
      if (value === "featured") {
        if (!model.featuredOnly) model.onToggleFeatured();
        return;
      }

      if (model.featuredOnly) {
        const nextSort = parseSort(value);
        void navigate({
          search: (prev) => ({
            ...prev,
            sort: nextSort,
            dir: parseDir(prev.dir, nextSort),
            featured: undefined,
            highlighted: undefined,
          }),
          replace: true,
        });
        return;
      }

      model.onSortChange(value);
    },
    [model.featuredOnly, model.onSortChange, model.onToggleFeatured, navigate],
  );

  const handleClear = useCallback(() => {
    model.onQueryChange("");
    if (model.featuredOnly) model.onToggleFeatured();
    if (model.nonSuspiciousOnly) model.onToggleNonSuspicious();
  }, [
    model.featuredOnly,
    model.onQueryChange,
    model.onToggleFeatured,
    model.onToggleNonSuspicious,
    model.nonSuspiciousOnly,
  ]);

  const handleCategoryChange = useCallback(
    (slug: string | undefined) => {
      if (slug) {
        const cat = SKILL_CATEGORIES.find((c) => c.slug === slug);
        if (cat?.keywords[0]) {
          model.onQueryChange(cat.keywords[0]);
        }
      } else {
        model.onQueryChange("");
      }
    },
    [model.onQueryChange],
  );

  const activeCategory = useMemo(() => {
    if (!model.query) return undefined;
    return (
      SKILL_CATEGORIES.find((c) => c.keywords.some((k) => k === model.query.trim().toLowerCase()))
        ?.slug ?? undefined
    );
  }, [model.query]);

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
          {totalSkillsText ? <span className="browse-count">{totalSkillsText}</span> : null}
        </h1>
      </div>
      <div className="browse-page-search">
        <Search size={15} className="navbar-search-icon" aria-hidden="true" />
        <input
          ref={searchInputRef}
          className="browse-search-input"
          value={model.query}
          onChange={(event) => model.onQueryChange(event.target.value)}
          placeholder="Search skills..."
        />
      </div>
      <div className={`browse-layout${sidebarOpen ? " sidebar-open" : ""}`}>
        <BrowseSidebar
          categories={SKILL_CATEGORIES}
          activeCategory={activeCategory}
          onCategoryChange={handleCategoryChange}
          sortOptions={[{ value: "featured", label: "Featured" }, ...sortOptionsWithRelevance]}
          activeSort={model.featuredOnly ? "featured" : model.sort}
          onSortChange={handleSortChange}
          filters={[
            { key: "nonSuspicious", label: "Hide suspicious", active: model.nonSuspiciousOnly },
          ]}
          onFilterToggle={handleFilterToggle}
        />
        <div className="browse-results">
          <div className="browse-results-toolbar">
            <span className="browse-results-count">
              {model.isLoadingSkills ? "\u2014" : `${model.sorted.length} results`}
              {model.hasQuery || model.featuredOnly || model.nonSuspiciousOnly ? (
                <button className="browse-clear-btn" type="button" onClick={handleClear}>
                  Clear
                </button>
              ) : null}
            </span>
            <div className="browse-view-toggle">
              <button
                className={`browse-view-btn${model.view === "list" ? " is-active" : ""}`}
                type="button"
                onClick={model.view === "cards" ? model.onToggleView : undefined}
              >
                List
              </button>
              <button
                className={`browse-view-btn${model.view === "cards" ? " is-active" : ""}`}
                type="button"
                onClick={model.view === "list" ? model.onToggleView : undefined}
              >
                Cards
              </button>
            </div>
          </div>
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
