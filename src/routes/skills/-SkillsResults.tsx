import type { RefObject } from "react";
import { SkillCard } from "../../components/SkillCard";
import { SkillListItem } from "../../components/SkillListItem";
import { getPlatformLabels } from "../../components/skillDetailUtils";
import { SkillStatsTripletLine } from "../../components/SkillStats";
import { Button } from "../../components/ui/button";
import { UserBadge } from "../../components/UserBadge";
import { getSkillBadges } from "../../lib/badges";
import { buildSkillHref, type SkillListEntry } from "./-types";

type SkillsResultsProps = {
  isLoadingSkills: boolean;
  sorted: SkillListEntry[];
  view: "cards" | "list";
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
        <div className="skeleton-list">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton-icon" />
              <div className="skeleton-row-body">
                <div className="skeleton-bar skeleton-bar-lg" />
                <div className="skeleton-bar skeleton-bar-sm" />
                <div className="skeleton-bar skeleton-bar-xs" />
              </div>
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">No skills found</p>
          <p className="empty-state-body">
            {hasQuery ? "Try a different search term or remove filters." : "No skills have been published yet."}
          </p>
        </div>
      ) : view === "cards" ? (
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
                      <SkillStatsTripletLine stats={skill.stats} />
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

      {canLoadMore || isLoadingMore ? (
        <div
          ref={canAutoLoad ? loadMoreRef : null}
          className="card mt-4 flex justify-center"
        >
          {canAutoLoad ? (
            isLoadingMore ? (
              "Loading more..."
            ) : (
              "Scroll to load more"
            )
          ) : (
            <Button type="button" onClick={loadMore} disabled={isLoadingMore}>
              {isLoadingMore ? "Loading..." : "Load more"}
            </Button>
          )}
        </div>
      ) : null}
    </>
  );
}
