import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import type { RefObject } from "react";
import { EmptyState } from "../../components/EmptyState";
import { SkillCardSkeletonGrid } from "../../components/skeletons/SkillCardSkeleton";
import { SkillCard } from "../../components/SkillCard";
import { getPlatformLabels } from "../../components/skillDetailUtils";
import { SkillMetricsRow, SkillStatsTripletLine } from "../../components/SkillStats";
import { Badge } from "../../components/ui/badge";
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
  listDoneLoading,
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
        <SkillCardSkeletonGrid count={6} />
      ) : sorted.length === 0 ? (
        <EmptyState
          title={listDoneLoading || hasQuery ? "No skills match that filter" : "Loading skills..."}
          description={hasQuery ? "Try adjusting your search or filters." : undefined}
        />
      ) : view === "cards" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
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
                  <>
                    <UserBadge
                      user={entry.owner}
                      fallbackHandle={ownerHandle}
                      prefix="by"
                      link={false}
                    />
                    <span className="text-[0.8rem] text-[color:var(--ink-soft)]">
                      <SkillStatsTripletLine stats={skill.stats} />
                    </span>
                  </>
                }
              />
            );
          })}
        </div>
      ) : (
        /* List view */
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--line)]">
          {/* Table header */}
          <div className="grid grid-cols-[minmax(160px,1.2fr)_minmax(120px,2fr)_minmax(100px,0.8fr)_minmax(80px,0.6fr)] gap-4 border-b border-[color:var(--line)] bg-[color:var(--surface-muted)] px-5 py-3 text-xs font-bold uppercase tracking-wider text-[color:var(--ink-soft)]">
            <span>Skill</span>
            <span>Summary</span>
            <span>Author</span>
            <span className="text-right">Stats</span>
          </div>
          {sorted.map((entry, i) => {
            const skill = entry.skill;
            const ownerHandle = entry.owner?.handle ?? entry.ownerHandle ?? null;
            const skillHref = buildSkillHref(skill, ownerHandle);
            return (
              <Link
                key={skill._id}
                className={`grid grid-cols-[minmax(160px,1.2fr)_minmax(120px,2fr)_minmax(100px,0.8fr)_minmax(80px,0.6fr)] items-center gap-4 px-5 py-3.5 no-underline transition-colors hover:bg-[color:var(--surface-muted)] ${
                  i % 2 === 0 ? "bg-[color:var(--surface)]" : "bg-[color:var(--bg-soft)]"
                }`}
                to={skillHref}
              >
                <span className="flex flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-[color:var(--ink)]">
                      {skill.displayName}
                    </span>
                    {getSkillBadges(skill).map((badge) => (
                      <Badge key={badge} variant="compact">
                        {badge}
                      </Badge>
                    ))}
                  </span>
                  {entry.latestVersion?.version ? (
                    <span className="font-mono text-xs text-[color:var(--ink-soft)]">
                      v{entry.latestVersion.version}
                    </span>
                  ) : null}
                </span>
                <span className="truncate text-sm text-[color:var(--ink-soft)]">
                  {skill.summary ?? "No summary provided."}
                </span>
                <span className="text-sm">
                  <UserBadge
                    user={entry.owner}
                    fallbackHandle={ownerHandle}
                    prefix=""
                    link={false}
                  />
                </span>
                <span className="flex flex-wrap justify-end gap-3 text-xs text-[color:var(--ink-soft)]">
                  <SkillMetricsRow stats={skill.stats} />
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Load more */}
      {(canLoadMore || isLoadingMore) && (
        <div ref={canAutoLoad ? loadMoreRef : null} className="flex justify-center pt-4">
          {canAutoLoad ? (
            isLoadingMore ? (
              <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--ink-soft)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading more...
              </div>
            ) : (
              <div className="text-sm text-[color:var(--ink-soft)]">Scroll to load more</div>
            )
          ) : (
            <Button
              variant="outline"
              onClick={loadMore}
              disabled={isLoadingMore}
              loading={isLoadingMore}
            >
              Load more
            </Button>
          )}
        </div>
      )}
    </>
  );
}
