import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { PluginListItem } from "../components/PluginListItem";
import { SkillListItem } from "../components/SkillListItem";
import { Card } from "../components/ui/card";
import type { PublicSkill } from "../lib/publicUser";
import {
  useUnifiedSearch,
  type UnifiedSearchType,
  type UnifiedPluginResult,
  type UnifiedSkillResult,
} from "../lib/useUnifiedSearch";

const SEARCH_PAGE_SIZE = 25;

type SearchState = {
  q?: string;
  type?: UnifiedSearchType;
};

export const Route = createFileRoute("/search")({
  validateSearch: (search): SearchState => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
    type: search.type === "skills" || search.type === "plugins" ? search.type : undefined,
  }),
  component: UnifiedSearchPage,
});

function UnifiedSearchPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const activeType = search.type ?? "all";
  const [query, setQuery] = useState(search.q ?? "");
  const [resultLimit, setResultLimit] = useState(SEARCH_PAGE_SIZE);

  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    setResultLimit(SEARCH_PAGE_SIZE);
  }, [search.q, activeType]);

  const { results, skillCount, pluginCount, isSearching } = useUnifiedSearch(
    search.q ?? "",
    activeType,
    {
      limits: {
        skills: resultLimit,
        plugins: resultLimit,
      },
    },
  );
  const canLoadMore =
    search.q &&
    !isSearching &&
    ((activeType === "all" && (skillCount >= resultLimit || pluginCount >= resultLimit)) ||
      (activeType === "skills" && skillCount >= resultLimit) ||
      (activeType === "plugins" && pluginCount >= resultLimit));

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void navigate({
      to: "/search",
      search: { q: query.trim() || undefined, type: search.type },
    });
  };

  const setType = (type: UnifiedSearchType) => {
    void navigate({
      to: "/search",
      search: { q: search.q, type: type === "all" ? undefined : type },
      replace: true,
    });
  };

  return (
    <main className="browse-page">
      <h1 className="browse-title mb-4">
        {search.q ? (
          <>
            Search results for <span className="text-[color:var(--accent)]">"{search.q}"</span>
          </>
        ) : (
          "Search"
        )}
      </h1>

      <form className="search-page-form" onSubmit={handleSearch}>
        <div className="browse-search-bar max-w-[560px] flex-1">
          <Search size={16} className="navbar-search-icon" aria-hidden="true" />
          <input
            className="browse-search-input"
            type="text"
            placeholder="Search skills and plugins..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
      </form>

      <div className="search-tabs">
        <button
          className={`search-tab${activeType === "all" ? " is-active" : ""}`}
          type="button"
          onClick={() => setType("all")}
        >
          All
        </button>
        <button
          className={`search-tab${activeType === "skills" ? " is-active" : ""}`}
          type="button"
          onClick={() => setType("skills")}
        >
          Skills
          {skillCount > 0 ? <span className="search-tab-count">{skillCount}</span> : null}
        </button>
        <button
          className={`search-tab${activeType === "plugins" ? " is-active" : ""}`}
          type="button"
          onClick={() => setType("plugins")}
        >
          Plugins
          {pluginCount > 0 ? <span className="search-tab-count">{pluginCount}</span> : null}
        </button>
      </div>

      {isSearching ? (
        <Card>
          <div className="loading-indicator">Searching...</div>
        </Card>
      ) : !search.q ? (
        <Card className="text-center p-10">
          <p className="text-ink-soft">Enter a search term to find skills and plugins</p>
        </Card>
      ) : results.length === 0 ? (
        <Card className="text-center p-10">
          <p className="text-ink-soft">No results found for "{search.q}"</p>
        </Card>
      ) : (
        <>
          <div className="results-list">
            {results.map((item) =>
              item.type === "skill" ? (
                <SkillResultRow key={`skill-${item.skill._id}`} result={item} />
              ) : (
                <PluginResultRow key={`plugin-${item.plugin.name}`} result={item} />
              ),
            )}
          </div>
          {canLoadMore ? (
            <div className="search-load-more">
              <button
                type="button"
                className="search-load-more-button"
                onClick={() => setResultLimit((limit) => limit + SEARCH_PAGE_SIZE)}
              >
                Load more
              </button>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}

function SkillResultRow({ result }: { result: UnifiedSkillResult }) {
  const skill = result.skill as unknown as PublicSkill;
  return <SkillListItem skill={skill} ownerHandle={result.ownerHandle} />;
}

function PluginResultRow({ result }: { result: UnifiedPluginResult }) {
  return <PluginListItem item={result.plugin} />;
}
