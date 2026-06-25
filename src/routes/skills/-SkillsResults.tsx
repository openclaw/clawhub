import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type { RefObject } from "react";
import { BrowseResultsSkeleton } from "../../components/skeletons/BrowseResultsSkeleton";
import { SkillCard } from "../../components/SkillCard";
import { SkillListItem } from "../../components/SkillListItem";
import { SkillStatsTripletLine } from "../../components/SkillStats";
import { Button } from "../../components/ui/button";
import { getSkillBadges } from "../../lib/badges";
import { timeAgo } from "../../lib/timeAgo";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { buildSkillHref, type SkillListEntry } from "./-types";
import type { SkillsView } from "./-useSkillsBrowseModel";

type SkillsResultsProps = {
  isLoadingSkills: boolean;
  sorted: SkillListEntry[];
  view: SkillsView;
  listDoneLoading: boolean;
  hasQuery: boolean;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  canAutoLoad: boolean;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  loadMore: () => void;
};

export function SkillsResults({
  isLoadingSkills,
  sorted,
  view,
  listDoneLoading,
  hasQuery,
  canLoadMore,
  isLoadingMore,
  canAutoLoad,
  loadMoreRef,
  loadMore,
}: SkillsResultsProps) {
  const isMobileBrowse = useMediaQuery("(max-width: 760px)");
  const effectiveView = isMobileBrowse ? "list" : view;

  return (
    <>
      {isLoadingSkills ? (
        <BrowseResultsSkeleton label="Skill" variant={effectiveView} />
      ) : sorted.length === 0 && listDoneLoading ? (
        <div className="empty-state">
          <p className="empty-state-title">No skills found</p>
          <p className="empty-state-body">
            {hasQuery
              ? "Try a different search term or remove filters."
              : "No skills have been published yet."}
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link to="/add" search={{ kind: "skill", ownerHandle: undefined }}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add a skill
            </Link>
          </Button>
        </div>
      ) : effectiveView === "grid" ? (
        <div className="grid browse-results-grid">
          {sorted.map((entry) => {
            const skill = entry.skill;
            const clawdis = entry.latestVersion?.parsed?.clawdis;
            const isPlugin = Boolean(clawdis?.nix?.plugin);
            const ownerHandle = entry.owner?.handle ?? entry.ownerHandle ?? null;
            const skillHref = buildSkillHref(skill, ownerHandle);
            return (
              <SkillCard
                key={skill._id}
                skill={skill}
                href={skillHref}
                className="skill-card-spaced-footer"
                badge={getSkillBadges(skill)}
                ownerHandle={ownerHandle}
                chip={isPlugin ? "Plugin bundle (nix)" : undefined}
                summaryFallback="Agent-ready skill pack."
                meta={
                  <div className="skill-card-grid-meta">
                    <SkillStatsTripletLine stats={skill.stats} />
                    <span className="skill-card-updated">Updated {timeAgo(skill.updatedAt)}</span>
                  </div>
                }
                owner={entry.owner}
              />
            );
          })}
        </div>
      ) : (
        <div className="browse-list-stack">
          <div className="browse-list-head" aria-hidden="true">
            <span className="browse-list-head-icon-spacer" />
            <span className="browse-list-head-label">Skill</span>
            <span className="browse-list-head-label">Category</span>
            <span className="browse-list-head-label browse-list-head-stat">Popularity</span>
          </div>
          <div className="results-list">
            {sorted.map((entry) => {
              const skill = entry.skill;
              const ownerHandle = entry.owner?.handle ?? entry.ownerHandle ?? null;
              return (
                <SkillListItem
                  key={skill._id}
                  skill={skill}
                  ownerHandle={ownerHandle}
                  owner={entry.owner}
                />
              );
            })}
          </div>
        </div>
      )}

      {isLoadingMore ? (
        <div ref={canAutoLoad ? loadMoreRef : null} className="mt-4">
          <BrowseResultsSkeleton count={2} variant={effectiveView} />
        </div>
      ) : canLoadMore ? (
        <div ref={canAutoLoad ? loadMoreRef : null} className="card mt-4 flex justify-center">
          {canAutoLoad ? (
            "Scroll to load more"
          ) : (
            <Button type="button" onClick={loadMore} disabled={isLoadingMore}>
              Load more
            </Button>
          )}
        </div>
      ) : null}
    </>
  );
}
