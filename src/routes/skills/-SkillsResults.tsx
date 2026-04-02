import { Link } from "@tanstack/react-router";
import type { RefObject } from "react";
import { SkillCard } from "../../components/SkillCard";
import { getPlatformLabels } from "../../components/skillDetailUtils";
import { SkillMetricsRow, SkillStatsTripletLine } from "../../components/SkillStats";
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
        <div className="card">
          <div className="loading-indicator">Loading skills…</div>
        </div>
      ) : sorted.length === 0 ? (
        <div className="card">
          {listDoneLoading || hasQuery ? "No skills match that filter." : "Loading skills…"}
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
        <div className="skills-table">
          <div className="skills-table-header">
            <span>Skill</span>
            <span>Summary</span>
            <span>Author</span>
            <span className="skills-table-stats">Stats</span>
          </div>
          {sorted.map((entry) => {
            const skill = entry.skill;
            const ownerHandle = entry.owner?.handle ?? entry.ownerHandle ?? null;
            const skillHref = buildSkillHref(skill, ownerHandle);
            return (
              <Link key={skill._id} className="skills-table-row" to={skillHref}>
                <span className="skills-table-name">
                  <span>
                    {skill.displayName}
                    {getSkillBadges(skill).map((badge) => (
                      <span key={badge} className="tag tag-compact">{badge}</span>
                    ))}
                  </span>
                  {entry.latestVersion?.version ? (
                    <span className="skills-table-version">v{entry.latestVersion.version}</span>
                  ) : null}
                </span>
                <span className="skills-table-summary">
                  {skill.summary ?? "No summary provided."}
                </span>
                <span className="skills-table-author">
                  <UserBadge
                    user={entry.owner}
                    fallbackHandle={ownerHandle}
                    prefix=""
                    link={false}
                  />
                </span>
                <span className="skills-table-stats">
                  <SkillMetricsRow stats={skill.stats} />
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {canLoadMore || isLoadingMore ? (
        <div
          ref={canAutoLoad ? loadMoreRef : null}
          className="card"
          style={{ marginTop: 16, display: "flex", justifyContent: "center" }}
        >
          {canAutoLoad ? (
            isLoadingMore ? (
              "Loading more…"
            ) : (
              "Scroll to load more"
            )
          ) : (
            <button className="btn" type="button" onClick={loadMore} disabled={isLoadingMore}>
              {isLoadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      ) : null}
    </>
  );
}
