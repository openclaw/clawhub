import type { RefObject } from "react";
import { BrowseResultsSkeleton } from "../../components/skeletons/BrowseResultsSkeleton";
import { SkillCard } from "../../components/SkillCard";
import { getPlatformLabels } from "../../components/skillDetailUtils";
import { SkillListItem } from "../../components/SkillListItem";
import { SkillStatsTripletLine } from "../../components/SkillStats";
import { Button } from "../../components/ui/button";
import { UserBadge } from "../../components/UserBadge";
import { getSkillBadges } from "../../lib/badges";
import { timeAgo } from "../../lib/timeAgo";
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
  listDoneLoading: _listDoneLoading,
  hasQuery,
  canLoadMore,
  isLoadingMore,
  canAutoLoad,
  loadMoreRef,
  loadMore,
}: SkillsResultsProps) {
  return (
    <>
      {isLoadingSkills ? (
        <BrowseResultsSkeleton variant={view} />
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">No skills found</p>
          <p className="empty-state-body">
            {hasQuery
              ? "Try a different search term or remove filters."
              : "No skills have been published yet."}
          </p>
        </div>
      ) : view === "grid" ? (
        <div className="grid">
          {sorted.map((entry) => {
            const skill = entry.skill;
            const clawdis = entry.latestVersion?.parsed?.clawdis;
            const isPlugin = Boolean(clawdis?.nix?.plugin);
            const platforms = getPlatformLabels(clawdis?.os, clawdis?.nix?.systems);
            const ownerHandle = entry.owner?.handle ?? entry.ownerHandle ?? null;
            const skillHref = buildSkillHref(skill, ownerHandle);
            return (
              <SkillCard
                key={skill._id}
                skill={skill}
                href={skillHref}
                className="skill-card-spaced-footer"
                badge={getSkillBadges(skill)}
                chip={isPlugin ? "Plugin bundle (nix)" : undefined}
                platformLabels={platforms.length ? platforms : undefined}
                summaryFallback="Agent-ready skill pack."
                meta={
                  <div className="skill-card-footer-rows">
                    <UserBadge
                      user={entry.owner}
                      fallbackHandle={ownerHandle}
                      prefix="by"
                      link={false}
                    />
                    <div className="stat">
                      <div className="skill-card-statline">
                        <span className="skill-card-updated">
                          Updated {timeAgo(skill.updatedAt)}
                        </span>
                        <SkillStatsTripletLine stats={skill.stats} />
                      </div>
                    </div>
                  </div>
                }
              />
            );
          })}
        </div>
      ) : (
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
      )}

      {isLoadingMore ? (
        <div ref={canAutoLoad ? loadMoreRef : null} className="mt-4">
          <BrowseResultsSkeleton count={2} variant={view} />
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
