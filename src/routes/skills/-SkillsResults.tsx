import { Link } from "@tanstack/react-router";
import { Download, ExternalLink, Plus } from "lucide-react";
import type { RefObject } from "react";
import { BrowseResultsSkeleton } from "../../components/skeletons/BrowseResultsSkeleton";
import { SkillListItem } from "../../components/SkillListItem";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { formatCompactStat } from "../../lib/numberFormat";
import { timeAgo } from "../../lib/timeAgo";
import { truncateText } from "../../lib/truncateText";
import {
  isExternalSkillListEntry,
  isTrendingSkillListEntry,
  type SkillListEntry,
  type SkillSearchEntry,
  type TrendingSkillListEntry,
} from "./-types";

type SkillsResultsProps = {
  isLoadingSkills: boolean;
  sorted: SkillListEntry[];
  listDoneLoading: boolean;
  hasQuery: boolean;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  canAutoLoad: boolean;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  loadMore: () => void;
  listFailed: boolean;
  retryLoad: () => void;
};

function TrendingSkillListItem({ item }: { item: TrendingSkillListEntry }) {
  const trending = item.trending;
  const owner = trending.publisher?.handle;
  return (
    <Link
      to={trending.canonicalUrl}
      className="skill-list-item skill-list-item-skill skill-list-item-no-icon skill-list-item-simple-no-icon"
    >
      <div className="skill-list-item-body">
        <div className="skill-list-item-main">
          <span className="skill-list-item-identity">
            <span className="skill-list-item-name" title={trending.displayName}>
              {truncateText(trending.displayName, 48)}
            </span>
            {owner ? <span className="skill-list-item-owner">@{owner}</span> : null}
          </span>
        </div>
        {trending.summary ? (
          <p className="skill-list-item-summary">{truncateText(trending.summary, 80)}</p>
        ) : null}
      </div>
      <div
        className="skill-list-item-meta"
        aria-label={trending.source === "skills-sh" ? "Source" : "24-hour downloads"}
      >
        {trending.source === "skills-sh" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="compact" size="sm">
                skills.sh
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" align="center">
              Synced from skills.sh
            </TooltipContent>
          </Tooltip>
        ) : typeof trending.metrics.trending24hDownloads === "number" ? (
          <span className="skill-list-item-meta-item">
            <Download size={14} aria-hidden="true" />
            {formatCompactStat(trending.metrics.trending24hDownloads)}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

function ExternalSkillSearchListItem({ result }: { result: SkillSearchEntry }) {
  const owner = result.sourceIdentity.owner ?? result.sourceIdentity.host;
  return (
    <a
      href={result.canonicalUrl}
      className="skill-list-item skill-list-item-skill skill-list-item-with-taxonomy skill-list-item-no-icon"
      target="_blank"
      rel="noreferrer"
    >
      <div className="skill-list-item-body">
        <div className="skill-list-item-main">
          <span className="skill-list-item-identity">
            <span className="skill-list-item-name" title={result.displayName}>
              {truncateText(result.displayName, 48)}
            </span>
            {owner ? <span className="skill-list-item-owner">@{owner}</span> : null}
          </span>
          <Badge variant="compact">skills.sh</Badge>
        </div>
        {result.summary ? (
          <p className="skill-list-item-summary">{truncateText(result.summary, 80)}</p>
        ) : null}
      </div>
      <div className="skill-list-item-taxonomy" aria-label="Source">
        <span className="skill-list-item-category">External source</span>
      </div>
      <div className="skill-list-item-meta">
        <span className="skill-list-item-meta-item is-updated">
          Observed {timeAgo(result.updatedAt)}
        </span>
        {typeof result.sourceIdentity.lifetimeInstalls === "number" ? (
          <span className="skill-list-item-meta-item" title="skills.sh lifetime installs">
            <Download size={14} aria-hidden="true" />
            {formatCompactStat(result.sourceIdentity.lifetimeInstalls)}
          </span>
        ) : null}
        <span className="skill-list-item-meta-item">
          <ExternalLink size={14} aria-hidden="true" /> Source
        </span>
      </div>
    </a>
  );
}

export function SkillsResults({
  isLoadingSkills,
  sorted,
  listDoneLoading,
  hasQuery,
  canLoadMore,
  isLoadingMore,
  canAutoLoad,
  loadMoreRef,
  loadMore,
  listFailed,
  retryLoad,
}: SkillsResultsProps) {
  return (
    <>
      {isLoadingSkills ? (
        <BrowseResultsSkeleton label="Skill" showIcon={false} />
      ) : listFailed && sorted.length === 0 ? (
        <div className="empty-state" role="alert">
          <p className="empty-state-title">Skills couldn't be loaded</p>
          <p className="empty-state-body">
            We couldn't load this slice of the catalog. Give it another try in a moment.
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={retryLoad}>
            Try again
          </Button>
        </div>
      ) : sorted.length === 0 && listDoneLoading ? (
        <div className="empty-state">
          <p className="empty-state-title">No skills found</p>
          <p className="empty-state-body">
            {hasQuery
              ? "Try a different search term or remove filters."
              : "Try another category or remove filters."}
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link to="/add" search={{ kind: "skill", ownerHandle: undefined, method: undefined }}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add a skill
            </Link>
          </Button>
        </div>
      ) : (
        <div className="browse-list-stack">
          <div className="browse-list-head browse-list-head-no-icon" aria-hidden="true">
            <span className="browse-list-head-label">Skill</span>
            <span className="browse-list-head-label browse-list-head-category">Category</span>
            <span className="browse-list-head-label browse-list-head-stat">Downloads</span>
          </div>
          <div className="results-list">
            {sorted.map((entry) => {
              if (isTrendingSkillListEntry(entry)) {
                return <TrendingSkillListItem key={entry.trending.id} item={entry} />;
              }
              if (isExternalSkillListEntry(entry)) {
                return (
                  <ExternalSkillSearchListItem key={entry.external.id} result={entry.external} />
                );
              }
              const skill = entry.skill;
              const ownerHandle = entry.owner?.handle ?? entry.ownerHandle ?? null;
              return (
                <SkillListItem
                  key={skill._id}
                  skill={skill}
                  ownerHandle={ownerHandle}
                  owner={entry.owner}
                  showIcon={false}
                />
              );
            })}
          </div>
        </div>
      )}

      {isLoadingMore ? (
        <div ref={canAutoLoad ? loadMoreRef : null} className="mt-4">
          <BrowseResultsSkeleton count={2} showIcon={false} />
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
