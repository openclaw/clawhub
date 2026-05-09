import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Search, X } from "lucide-react";
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
  nonSuspicious?: boolean;
};

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>): SearchState => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
    type: search.type === "skills" || search.type === "plugins" ? search.type : undefined,
    nonSuspicious:
      search.nonSuspicious === false || search.nonSuspicious === "false" ? false : undefined,
  }),
  component: UnifiedSearchPage,
});

function UnifiedSearchPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const activeType = search.type ?? "all";
  // Unified search defaults to moderation-safe (suspicious skills hidden).
  // Users can opt in to seeing all results via the chip below; that flips
  // nonSuspicious to false in the URL, mirroring /skills' URL param name.
  const nonSuspiciousOnly = search.nonSuspicious ?? true;
  const [query, setQuery] = useState(search.q ?? "");
  const [resultLimit, setResultLimit] = useState(SEARCH_PAGE_SIZE);

  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    setResultLimit(SEARCH_PAGE_SIZE);
  }, [search.q, activeType, nonSuspiciousOnly]);

  const {
    results: allResults,
    skillCount,
    pluginCount,
    isSearching,
  } = useUnifiedSearch(search.q ?? "", "all", {
    limits: {
      skills: resultLimit,
      plugins: resultLimit,
    },
    nonSuspiciousOnly,
  });
  const results =
    activeType === "all"
      ? allResults
      : allResults.filter((item) => item.type === (activeType === "skills" ? "skill" : "plugin"));
  const showSearchCounts = Boolean(search.q);
  const allCount = skillCount + pluginCount;
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
      search: {
        q: query.trim() || undefined,
        type: search.type,
        nonSuspicious: search.nonSuspicious,
      },
    });
  };

  const setType = (type: UnifiedSearchType) => {
    void navigate({
      to: "/search",
      search: {
        q: search.q,
        type: type === "all" ? undefined : type,
        nonSuspicious: search.nonSuspicious,
      },
      replace: true,
    });
  };

  const toggleNonSuspicious = () => {
    void navigate({
      to: "/search",
      search: {
        q: search.q,
        type: search.type,
        // Default is true (hide suspicious); only persist the opt-out (false) in the URL.
        nonSuspicious: nonSuspiciousOnly ? false : undefined,
      },
      replace: true,
    });
  };

  const clearSearch = () => {
    setQuery("");
    void navigate({
      to: "/search",
      search: { q: undefined, type: search.type },
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
        <div className="browse-search-bar search-page-field max-w-[560px] flex-1">
          <Search size={16} className="navbar-search-icon" aria-hidden="true" />
          <input
            className="browse-search-input"
            type="text"
            placeholder="Search skills and plugins..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query ? (
            <button
              className="search-clear-button"
              type="button"
              aria-label="Clear search"
              onClick={clearSearch}
            >
              <X size={15} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </form>

      <div className="search-tabs">
        <button
          className={`search-tab${activeType === "all" ? " is-active" : ""}`}
          type="button"
          onClick={() => setType("all")}
        >
          All {showSearchCounts ? <span className="search-tab-count">{allCount}</span> : null}
        </button>
        <button
          className={`search-tab${activeType === "skills" ? " is-active" : ""}`}
          type="button"
          onClick={() => setType("skills")}
        >
          Skills {showSearchCounts ? <span className="search-tab-count">{skillCount}</span> : null}
        </button>
        <button
          className={`search-tab${activeType === "plugins" ? " is-active" : ""}`}
          type="button"
          onClick={() => setType("plugins")}
        >
          Plugins{" "}
          {showSearchCounts ? <span className="search-tab-count">{pluginCount}</span> : null}
        </button>
      </div>

      {search.q && activeType !== "plugins" ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SuspiciousFilterChip active={nonSuspiciousOnly} onClick={toggleNonSuspicious} />
        </div>
      ) : null}

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

function SuspiciousFilterChip({ active, onClick }: { active: boolean; onClick: () => void }) {
  // Mirrors the FilterChip styling from /skills so the two surfaces feel consistent.
  // `active` means suspicious skills are being hidden (the moderation-safe default).
  const label = active ? "Hiding suspicious skills" : "Showing all skills";
  const actionLabel = active ? "Show all" : "Hide suspicious";
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={
        active
          ? "Suspicious skills are hidden. Click to show all skills."
          : "All skills are shown. Click to hide suspicious skills."
      }
      className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[rgba(29,59,78,0.22)] bg-[rgba(255,255,255,0.94)] px-3.5 text-xs font-semibold transition-all duration-150 dark:border-[rgba(255,255,255,0.12)] dark:bg-[rgba(14,28,37,0.84)] ${
        active
          ? "border-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 text-[color:var(--accent)] dark:border-[rgba(255,131,95,0.34)] dark:bg-[rgba(255,131,95,0.14)] dark:text-[#ffd5c9]"
          : "text-[color:var(--ink-soft)] hover:border-[color:var(--border-ui-hover)] hover:text-[color:var(--ink)] dark:text-[rgba(245,238,232,0.88)] dark:hover:border-[rgba(255,255,255,0.2)] dark:hover:text-[rgba(245,238,232,0.96)]"
      }`}
    >
      {active ? <Check className="h-3 w-3" /> : null}
      <span>{label}</span>
      <span aria-hidden="true" className="opacity-50">
        ·
      </span>
      <span className="underline-offset-2 hover:underline">{actionLabel}</span>
    </button>
  );
}

function SkillResultRow({ result }: { result: UnifiedSkillResult }) {
  const skill = result.skill as unknown as PublicSkill;
  return <SkillListItem skill={skill} ownerHandle={result.ownerHandle} />;
}

function PluginResultRow({ result }: { result: UnifiedPluginResult }) {
  return <PluginListItem item={result.plugin} />;
}
