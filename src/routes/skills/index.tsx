import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useRef } from "react";
import { api } from "../../../convex/_generated/api";
import { SKILL_CAPABILITY_TAGS } from "../../../convex/lib/skillCapabilityTags";
import { Container } from "../../components/layout/Container";
import { parseSort } from "./-params";
import { SkillsResults } from "./-SkillsResults";
import { SkillsToolbar } from "./-SkillsToolbar";
import { useSkillsBrowseModel, type SkillsSearchState } from "./-useSkillsBrowseModel";

const SKILL_CAPABILITY_TAG_SET = new Set<string>(SKILL_CAPABILITY_TAGS);

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
      nonSuspicious:
        search.nonSuspicious === "1" ||
        search.nonSuspicious === "true" ||
        search.nonSuspicious === true
          ? true
          : undefined,
      tag:
        typeof search.tag === "string" && SKILL_CAPABILITY_TAG_SET.has(search.tag)
          ? search.tag
          : undefined,
      view: search.view === "cards" || search.view === "list" ? search.view : undefined,
      focus: search.focus === "search" ? "search" : undefined,
    };
  },
  beforeLoad: ({ search }) => {
    const hasQuery = Boolean(search.q?.trim());
    if (hasQuery || search.sort) return;
    throw redirect({
      to: "/skills",
      search: {
        q: search.q || undefined,
        sort: "downloads",
        dir: search.dir || undefined,
        highlighted: search.highlighted || undefined,
        nonSuspicious: search.nonSuspicious || undefined,
        tag: search.tag || undefined,
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
  const totalSkillsText =
    typeof totalSkills === "number" ? totalSkills.toLocaleString("en-US") : null;

  const model = useSkillsBrowseModel({
    navigate,
    search,
    searchInputRef,
  });

  return (
    <main className="py-10">
      <Container size="wide">
        <div className="flex flex-col gap-6">
          {/* Header */}
          <header>
            <h1 className="font-display text-2xl font-bold text-[color:var(--ink)]">
              Skills
              {totalSkillsText && (
                <span className="ml-2 text-lg font-normal text-[color:var(--ink-soft)] opacity-70">
                  ({totalSkillsText})
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-[color:var(--ink-soft)]">
              {model.isLoadingSkills
                ? "Loading skills..."
                : `Browse the skill library${model.activeFilters.length ? ` (${model.activeFilters.join(", ")})` : ""}.`}
            </p>
          </header>

          {/* Toolbar */}
          <SkillsToolbar
            searchInputRef={searchInputRef}
            query={model.query}
            hasQuery={model.hasQuery}
            sort={model.sort}
            dir={model.dir}
            view={model.view}
            highlightedOnly={model.highlightedOnly}
            nonSuspiciousOnly={model.nonSuspiciousOnly}
            capabilityTag={model.capabilityTag}
            onQueryChange={model.onQueryChange}
            onToggleHighlighted={model.onToggleHighlighted}
            onToggleNonSuspicious={model.onToggleNonSuspicious}
            onCapabilityTagChange={model.onCapabilityTagChange}
            onSortChange={model.onSortChange}
            onToggleDir={model.onToggleDir}
            onToggleView={model.onToggleView}
          />

          {/* Results count */}
          {!model.isLoadingSkills && model.sorted.length > 0 && (
            <p className="text-xs font-medium text-[color:var(--ink-soft)]">
              Showing {model.sorted.length}
              {totalSkillsText ? ` of ${totalSkillsText}` : ""} skills
              {model.hasQuery ? ` matching "${model.query}"` : ""}
            </p>
          )}

          {/* Results */}
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
      </Container>
    </main>
  );
}
