import { Link } from "@tanstack/react-router";
import type { ClawdisSkillMetadata } from "clawhub-schema";
import { PLATFORM_SKILL_LICENSE } from "clawhub-schema/licenseConstants";
import { Bookmark, Flag, Settings, ShieldCheck, Upload } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { ActivityTrend } from "../lib/activityTrend";
import { getSkillBadges, isSkillOfficial } from "../lib/badges";
import { BrowseCategoryIcon } from "../lib/browseCategoryIcons";
import {
  buildSkillCategoryBrowseHref,
  buildSkillTopicBrowseHref,
  formatCatalogTopicLabel,
  type SkillCategory,
} from "../lib/categories";
import { formatSkillStatsTriplet } from "../lib/numberFormat";
import { buildPublisherProfileHref } from "../lib/ownerRoute";
import { presentationTitle } from "../lib/presentationTitle";
import type { PublicPublisher, PublicSkill } from "../lib/publicUser";
import { timeAgo } from "../lib/timeAgo";
import { useHeroCreatorPublisher } from "../lib/useHeroCreatorPublisher";
import { useMediaQuery } from "../lib/useMediaQuery";
import { cn } from "../lib/utils";
import { ActivityMetricLabel } from "./ActivityMetricLabel";
import { DetailHero, DetailPageShell, DETAIL_HERO_TOPIC_LIMIT } from "./DetailPageShell";
import { DetailSecuritySummaryLabel } from "./DetailSecuritySummary";
import { useDownloadsSidebarMetricBlock } from "./DownloadsMetricCard";
import { InlineCodeSummary } from "./InlineCodeSummary";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { SidebarMetadata } from "./SidebarMetadata";
import { buildSkillHref } from "./skillDetailUtils";
import { SkillCommandLineCard } from "./SkillInstallSurface";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { UserBadge } from "./UserBadge";

type SkillModerationInfo = {
  isPendingScan: boolean;
  isMalwareBlocked: boolean;
  isSuspicious: boolean;
  isHiddenByMod: boolean;
  isRemoved: boolean;
  verdict?: "clean" | "suspicious" | "malicious";
  reason?: string;
};

type SkillFork = {
  kind: "fork" | "duplicate";
  version: string | null;
  skill: { slug: string; displayName: string };
  owner: { handle: string | null; userId: Id<"users"> | null };
};

type SkillCanonical = {
  skill: { slug: string; displayName: string };
  owner: { handle: string | null; userId: Id<"users"> | null };
};

const SUMMARY_COLLAPSE_THRESHOLD = 220;

type MobileDetailPanel = "content" | "stats";

function formatHeaderTopic(topic: string) {
  return formatCatalogTopicLabel(topic);
}

type SkillDetailLatestVersion =
  | (Omit<Doc<"skillVersions">, "parsed"> & {
      parsed?: (Partial<Doc<"skillVersions">["parsed"]> & { description?: string }) | null;
    })
  | null;

function getLatestVersionDescription(latestVersion: SkillDetailLatestVersion) {
  const parsed = latestVersion?.parsed;
  const description =
    typeof parsed?.presentation?.summary === "string"
      ? parsed.presentation.summary
      : typeof parsed?.description === "string"
        ? parsed.description
        : typeof parsed?.frontmatter?.description === "string"
          ? parsed.frontmatter.description
          : null;
  return description?.trim() || null;
}

export type SkillDetailViewSkill = {
  _id?: string;
  slug: string;
  displayName: string;
  summary?: string | null;
  icon?: string | null;
  ownerUserId?: Id<"users">;
  ownerPublisherId?: Id<"publishers">;
  installKind?: PublicSkill["installKind"];
  githubSourceRepo?: string;
  githubPath?: string;
  githubCurrentCommit?: string;
  githubCurrentStatus?: PublicSkill["githubCurrentStatus"];
  githubScanStatus?: PublicSkill["githubScanStatus"];
  githubHasSkillCard?: boolean;
  categories?: string[];
  inferredCategories?: string[];
  latestVersionId?: Id<"skillVersions">;
  inferredFromVersionId?: Id<"skillVersions">;
  topics?: string[];
  badges?: PublicSkill["badges"];
  stats: {
    downloads: number;
    stars: number;
    installs?: number | null;
    installsAllTime?: number;
    installsCurrent?: number;
    versions?: number;
    comments?: number;
  };
  updatedAt: number;
};

function getGitHubRepositoryLink(skill: SkillDetailViewSkill) {
  const repo = "githubSourceRepo" in skill ? skill.githubSourceRepo : undefined;
  if (skill.installKind !== "github" || !repo) return null;

  return (
    <a
      href={`https://github.com/${repo}`}
      target="_blank"
      rel="noopener noreferrer"
      className="plugin-external-link"
    >
      {repo}
    </a>
  );
}

export type SkillDetailPageViewProps = {
  skill: SkillDetailViewSkill;
  owner: PublicPublisher | null;
  ownerHandle: string | null;
  latestVersion: SkillDetailLatestVersion;
  modInfo: SkillModerationInfo | null;
  canManage: boolean;
  isAuthenticated: boolean;
  isStaff: boolean;
  isStarred: boolean | undefined;
  onToggleStar: () => void;
  onOpenReport: () => void;
  onRequireSignIn: () => void;
  forkOf: SkillFork | null;
  forkOfLabel: string;
  forkOfHref: string | null;
  forkOfOwnerHandle: string | null;
  canonical: SkillCanonical | null;
  canonicalHref: string | null;
  canonicalOwnerHandle: string | null;
  staffVisibilityTag: string | null;
  isAutoHidden: boolean;
  isRemoved: boolean;
  nixPlugin: string | undefined;
  hasPluginBundle: boolean;
  configRequirements: ClawdisSkillMetadata["config"] | undefined;
  cliHelp: string | undefined;
  clawdis: ClawdisSkillMetadata | undefined;
  category?: SkillCategory | null;
  categories?: SkillCategory[] | null;
  staffVisibilityAlert?: ReactNode;
  postInstallContent?: ReactNode;
  securityAuditSummary?: ReactNode;
  activityTrend?: ActivityTrend | null;
  activityTrendLoading?: boolean;
  newVersionHref?: string | null;
  settingsHref?: string | null;
  showArchiveMetadata?: boolean;
  titleAccessory?: ReactNode;
  breadcrumbOwnerHref?: string | null;
  breadcrumbOwnerLabel?: ReactNode;
  breadcrumbSkillHref?: string;
  creatorContent?: ReactNode;
  heroNotice?: ReactNode;
  taxonomyPrefix?: ReactNode;
  installContent?: ReactNode;
  renderSidebarContent?: () => ReactNode;
  showBookmarkAction?: boolean;
  showReportAction?: boolean;
  pageClassName?: string;
  pageOverlays?: ReactNode;
  children?: ReactNode;
};

export function SkillDetailPageView({
  skill,
  owner,
  ownerHandle,
  latestVersion,
  modInfo,
  canManage,
  isAuthenticated,
  isStaff,
  isStarred,
  onToggleStar,
  onOpenReport,
  onRequireSignIn,
  forkOf,
  forkOfLabel,
  forkOfHref,
  forkOfOwnerHandle,
  canonical,
  canonicalHref,
  canonicalOwnerHandle,
  nixPlugin,
  hasPluginBundle,
  configRequirements,
  cliHelp,
  clawdis,
  category,
  categories,
  staffVisibilityAlert,
  postInstallContent,
  securityAuditSummary,
  activityTrend,
  activityTrendLoading = false,
  newVersionHref,
  settingsHref,
  showArchiveMetadata = true,
  titleAccessory,
  breadcrumbOwnerHref,
  breadcrumbOwnerLabel,
  breadcrumbSkillHref,
  creatorContent,
  heroNotice,
  taxonomyPrefix,
  installContent,
  renderSidebarContent,
  showBookmarkAction = true,
  showReportAction: showReportActionOverride,
  pageClassName,
  pageOverlays,
  children,
}: SkillDetailPageViewProps) {
  const formattedStats = formatSkillStatsTriplet(skill.stats);
  const installOwnerId = owner?._id ?? skill.ownerPublisherId ?? skill.ownerUserId ?? null;
  const hasOwnerActions = Boolean(newVersionHref) || Boolean(settingsHref);
  const showReportAction = showReportActionOverride ?? (!canManage || isStaff);
  const badges = getSkillBadges(skill);
  const titleBadges = badges.filter((badge) => badge !== "Official");
  const heroCreatorPublisher = useHeroCreatorPublisher({
    owner,
    skillOfficial: isSkillOfficial(skill),
  });
  const showHeroMeta = Boolean((forkOf && forkOfHref) || canonicalHref);
  const showTitleBadges = titleBadges.length > 0;
  const headerDescription =
    getLatestVersionDescription(latestVersion) ?? skill.summary ?? "No summary provided.";
  const headerTopics = (skill.topics ?? [])
    .map((topic) => topic.trim())
    .filter(Boolean)
    .slice(0, DETAIL_HERO_TOPIC_LIMIT);
  const headerCategories = (categories ?? (category ? [category] : [])).slice(0, 3);
  const hasSummaryToggle = headerDescription.length > SUMMARY_COLLAPSE_THRESHOLD;
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const [mobileDetailPanel, setMobileDetailPanel] = useState<MobileDetailPanel>("content");
  const isMobileDetailLayout = useMediaQuery("(max-width: 900px)");

  const renderStarAction = () => (
    <SignedInActionTooltip
      isAuthenticated={isAuthenticated}
      message="You must be signed in to bookmark a skill"
    >
      <button
        type="button"
        className="skill-sidebar-action-link skill-sidebar-star-action"
        onClick={isAuthenticated ? onToggleStar : onRequireSignIn}
        aria-pressed={Boolean(isAuthenticated && isStarred)}
        aria-label={isStarred ? "Unbookmark skill" : "Bookmark skill"}
      >
        <Bookmark
          size={14}
          aria-hidden="true"
          fill={isAuthenticated && isStarred ? "currentColor" : "none"}
        />
        {isAuthenticated && isStarred ? "Unbookmark" : "Bookmark"}
        <span className="skill-action-count">{formattedStats.stars}</span>
      </button>
    </SignedInActionTooltip>
  );

  const renderSidebarActions = () => {
    if (!showReportAction) return null;
    return (
      <div className="skill-sidebar-actions skill-sidebar-actions-secondary">
        <SignedInActionTooltip
          isAuthenticated={isAuthenticated}
          message="You must be signed in to report a skill"
        >
          <button
            type="button"
            className="skill-sidebar-action-link"
            onClick={isAuthenticated ? onOpenReport : onRequireSignIn}
          >
            <Flag size={14} aria-hidden="true" />
            Report
          </button>
        </SignedInActionTooltip>
      </div>
    );
  };

  const managementToolbar =
    hasOwnerActions || isStaff || staffVisibilityAlert ? (
      <div className="skill-management-toolbar">
        {staffVisibilityAlert ? (
          <div className="skill-management-toolbar-alert">{staffVisibilityAlert}</div>
        ) : null}
        {hasOwnerActions || isStaff ? (
          <div className="skill-management-toolbar-inner">
            {newVersionHref ? (
              <Button asChild variant="ghost" size="xs" className="skill-management-toolbar-action">
                <a href={newVersionHref} aria-label="New version">
                  <Upload size={13} aria-hidden="true" />
                  New version
                </a>
              </Button>
            ) : null}
            {settingsHref ? (
              <Button asChild variant="ghost" size="xs" className="skill-management-toolbar-action">
                <a href={settingsHref} aria-label="Settings">
                  <Settings size={13} aria-hidden="true" />
                  Settings
                </a>
              </Button>
            ) : null}
            {isStaff ? (
              <Button asChild variant="ghost" size="xs" className="skill-management-toolbar-action">
                <Link to="/management" search={{ skill: skill.slug, plugin: undefined }}>
                  <ShieldCheck size={13} aria-hidden="true" />
                  Manage
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null;

  const defaultStatsContent = () => (
    <>
      <SkillSidebarDeferredStats
        skill={skill}
        owner={owner}
        ownerHandle={ownerHandle}
        formattedStats={formattedStats}
        latestVersion={latestVersion}
        showArchiveMetadata={showArchiveMetadata}
        securityAuditSummary={securityAuditSummary}
        activityTrend={activityTrend}
        activityTrendLoading={activityTrendLoading}
        hideCreator
      />
      {renderSidebarActions()}
    </>
  );
  // Match the normal shell's CSS-exclusive desktop/mobile copies so responsive
  // transitions never move or remount the active sidebar subtree.
  const desktopStatsContent = renderSidebarContent ? renderSidebarContent() : defaultStatsContent();
  const mobileStatsContent = renderSidebarContent ? renderSidebarContent() : defaultStatsContent();
  const resolvedBreadcrumbOwnerHref =
    breadcrumbOwnerHref === undefined
      ? ownerHandle
        ? buildPublisherProfileHref(ownerHandle)
        : "#"
      : breadcrumbOwnerHref;
  const displayName = presentationTitle(skill.displayName, skill.slug);

  return (
    <main className={cn("section detail-page-section skill-detail-page", pageClassName)}>
      <DetailPageShell>
        {modInfo?.isPendingScan ? (
          <div className="pending-banner">
            <div className="pending-banner-content">
              <strong>Security scan in progress</strong>
              <p>
                Your skill is being scanned by VirusTotal. It will be visible to others once the
                scan completes. This usually takes up to 5 minutes — grab a coffee or exfoliate your
                shell while you wait.
              </p>
            </div>
          </div>
        ) : modInfo?.isRemoved ? (
          <div className="pending-banner pending-banner-blocked">
            <div className="pending-banner-content">
              <strong>Skill removed by moderator</strong>
              <p>This skill has been removed and is not visible to others.</p>
            </div>
          </div>
        ) : modInfo?.isHiddenByMod ? (
          <div className="pending-banner pending-banner-blocked">
            <div className="pending-banner-content">
              <strong>Skill hidden</strong>
              <p>This skill is currently hidden and not visible to others.</p>
            </div>
          </div>
        ) : null}

        {managementToolbar}

        <DetailHero
          topClassName={hasPluginBundle ? "has-plugin" : undefined}
          sidebar={
            <div className="skill-hero-sidebar-stack">
              {!isMobileDetailLayout && showBookmarkAction ? (
                <div className="skill-sidebar-star-band detail-hero-summary-row">
                  {renderStarAction()}
                </div>
              ) : null}
              <div className="detail-sidebar-stats">{desktopStatsContent}</div>
            </div>
          }
          main={
            <>
              <div className="skill-hero-title">
                <nav className="skill-hero-breadcrumbs" aria-label="Skill breadcrumbs">
                  <a href="/skills">skills</a>
                  <span aria-hidden="true">/</span>
                  {resolvedBreadcrumbOwnerHref ? (
                    <a href={resolvedBreadcrumbOwnerHref}>
                      {breadcrumbOwnerLabel ??
                        ownerHandle ??
                        owner?.displayName ??
                        owner?._id ??
                        "unknown"}
                    </a>
                  ) : (
                    <span>
                      {breadcrumbOwnerLabel ??
                        ownerHandle ??
                        owner?.displayName ??
                        owner?._id ??
                        "unknown"}
                    </span>
                  )}
                  <span aria-hidden="true">/</span>
                  <a
                    href={
                      breadcrumbSkillHref ??
                      buildSkillHref(ownerHandle, owner?._id ?? null, skill.slug)
                    }
                    aria-current="page"
                  >
                    {skill.slug}
                  </a>
                </nav>
                <div className="skill-hero-heading-stack">
                  {taxonomyPrefix || headerCategories.length > 0 || headerTopics.length > 0 ? (
                    <div className="skill-hero-taxonomy-row" aria-label="Skill metadata">
                      {taxonomyPrefix ? (
                        <div className="skill-hero-taxonomy-prefix">{taxonomyPrefix}</div>
                      ) : null}
                      {taxonomyPrefix &&
                      (headerCategories.length > 0 || headerTopics.length > 0) ? (
                        <span className="skill-hero-taxonomy-separator" aria-hidden="true" />
                      ) : null}
                      {headerCategories.length > 0 ? (
                        <div className="skill-category-meta-list" aria-label="Categories">
                          {headerCategories.map((categoryItem) => (
                            <a
                              key={categoryItem.slug}
                              className="skill-category-meta-link"
                              href={buildSkillCategoryBrowseHref(categoryItem)}
                              aria-label={`View ${categoryItem.label} skills`}
                            >
                              <BrowseCategoryIcon
                                slug={categoryItem.slug}
                                icon={categoryItem.icon}
                                size={14}
                                className="skill-category-icon"
                              />
                              <span>{categoryItem.label}</span>
                            </a>
                          ))}
                        </div>
                      ) : null}
                      {headerCategories.length > 0 && headerTopics.length > 0 ? (
                        <span className="skill-hero-taxonomy-separator" aria-hidden="true" />
                      ) : null}
                      {headerTopics.length > 0 ? (
                        <div className="skill-hero-topic-list" aria-label="Topics">
                          {headerTopics.map((topic) => (
                            <a
                              key={topic}
                              className="skill-hero-topic"
                              href={buildSkillTopicBrowseHref(topic)}
                              aria-label={`View skills tagged ${formatHeaderTopic(topic)}`}
                            >
                              {formatHeaderTopic(topic)}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="skill-hero-title-row">
                    {skill.icon ? (
                      <MarketplaceIcon
                        kind="skill"
                        label={displayName}
                        imageUrl={skill.icon}
                        skill={skill}
                        size="md"
                      />
                    ) : null}
                    <h1 className="skill-page-title">{displayName}</h1>
                    {showTitleBadges ? (
                      <div className="skill-title-badges">
                        {titleBadges.map((badge) => (
                          <Badge key={badge} variant="compact">
                            {badge}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {nixPlugin ? <Badge variant="accent">Plugin bundle (nix)</Badge> : null}
                    {titleAccessory}
                  </div>
                  {showHeroMeta ? (
                    <div className="skill-hero-meta-row" aria-label="Skill lineage">
                      {forkOf && forkOfHref ? (
                        <span className="skill-hero-meta-item">
                          <span className="skill-hero-meta-label">{forkOfLabel}</span>
                          <a className="skill-hero-meta-link" href={forkOfHref}>
                            {forkOfOwnerHandle ? `@${forkOfOwnerHandle}/` : ""}
                            {forkOf.skill.slug}
                          </a>
                          {forkOf.version ? (
                            <span className="skill-hero-meta-version">({forkOf.version})</span>
                          ) : null}
                        </span>
                      ) : null}
                      {canonicalHref ? (
                        <span className="skill-hero-meta-item">
                          <span className="skill-hero-meta-label">canonical</span>
                          <a className="skill-hero-meta-link" href={canonicalHref}>
                            {canonicalOwnerHandle ? `@${canonicalOwnerHandle}/` : ""}
                            {canonical?.skill?.slug}
                          </a>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="skill-summary-block">
                  <p
                    className={`section-subtitle skill-summary-line${
                      hasSummaryToggle && !isSummaryExpanded ? " line-clamp-2" : ""
                    }`}
                  >
                    <InlineCodeSummary>{headerDescription}</InlineCodeSummary>
                  </p>
                  {hasSummaryToggle ? (
                    <button
                      type="button"
                      className="skill-summary-toggle"
                      aria-expanded={isSummaryExpanded}
                      onClick={() => setIsSummaryExpanded((expanded) => !expanded)}
                    >
                      {isSummaryExpanded ? "Show less" : "Read more"}
                    </button>
                  ) : null}
                </div>
                {creatorContent || owner || ownerHandle ? (
                  <div className="skill-hero-creator">
                    {creatorContent ?? (
                      <UserBadge
                        user={heroCreatorPublisher}
                        fallbackHandle={ownerHandle}
                        prefix=""
                        size="md"
                        showName
                        showHandle={false}
                        showMutedHandle
                        stackMutedHandleBelowName
                        disableTooltip
                      />
                    )}
                    {isMobileDetailLayout && showBookmarkAction ? (
                      <div className="skill-hero-creator-star">{renderStarAction()}</div>
                    ) : null}
                  </div>
                ) : null}

                {heroNotice}

                {nixPlugin ? (
                  <div className="skill-hero-note">
                    Bundles the skill pack, CLI binary, and config requirements in one Nix install.
                  </div>
                ) : null}
              </div>
            </>
          }
        >
          <div className="detail-mobile-install">
            {installContent ?? (
              <SkillCommandLineCard
                slug={skill.slug}
                displayName={skill.displayName}
                ownerHandle={ownerHandle}
                ownerId={installOwnerId}
                clawdis={clawdis}
              />
            )}
          </div>

          <div className="detail-mobile-master-tabs" data-active={mobileDetailPanel}>
            <div
              className="detail-mobile-master-tab-list"
              role="tablist"
              aria-label="Skill mobile sections"
            >
              <button
                id="skill-mobile-master-tab-content"
                className={`detail-mobile-master-tab${
                  mobileDetailPanel === "content" ? " is-active" : ""
                }`}
                type="button"
                role="tab"
                aria-selected={mobileDetailPanel === "content"}
                aria-controls="skill-mobile-master-panel-content"
                onClick={() => setMobileDetailPanel("content")}
              >
                SKILL.md
              </button>
              <button
                id="skill-mobile-master-tab-stats"
                className={`detail-mobile-master-tab${
                  mobileDetailPanel === "stats" ? " is-active" : ""
                }`}
                type="button"
                role="tab"
                aria-selected={mobileDetailPanel === "stats"}
                aria-controls="skill-mobile-master-panel-stats"
                onClick={() => setMobileDetailPanel("stats")}
              >
                Stats & details
              </button>
            </div>
            <div
              className="detail-mobile-master-panel detail-mobile-master-panel-content"
              id="skill-mobile-master-panel-content"
              role="tabpanel"
              aria-labelledby="skill-mobile-master-tab-content"
              hidden={mobileDetailPanel !== "content"}
            >
              {postInstallContent}

              {children}

              {hasPluginBundle ? (
                <div className="skill-panel bundle-card">
                  <div className="bundle-header">
                    <div className="bundle-title">Plugin bundle (nix)</div>
                    <div className="bundle-subtitle">Skill pack · CLI binary · Config</div>
                  </div>
                  <div className="bundle-includes">
                    <span>SKILL.md</span>
                    <span>CLI</span>
                    <span>Config</span>
                  </div>
                  {configRequirements ? (
                    <div className="bundle-section">
                      <div className="bundle-section-title">Config requirements</div>
                      <div className="bundle-meta">
                        {configRequirements.requiredEnv?.length ? (
                          <div className="stat">
                            <strong>Required env</strong>
                            <span>{configRequirements.requiredEnv.join(", ")}</span>
                          </div>
                        ) : null}
                        {configRequirements.stateDirs?.length ? (
                          <div className="stat">
                            <strong>State dirs</strong>
                            <span>{configRequirements.stateDirs.join(", ")}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {cliHelp ? (
                    <details className="bundle-section bundle-details">
                      <summary>CLI help (from plugin)</summary>
                      <pre className="hero-install-code mono">{cliHelp}</pre>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div
              className="detail-mobile-master-panel detail-mobile-master-stats"
              id="skill-mobile-master-panel-stats"
              role="tabpanel"
              aria-labelledby="skill-mobile-master-tab-stats"
              hidden={mobileDetailPanel !== "stats"}
            >
              {mobileStatsContent}
            </div>
          </div>
        </DetailHero>
      </DetailPageShell>
      {pageOverlays}
    </main>
  );
}

function SignedInActionTooltip({
  children,
  isAuthenticated,
  message,
}: {
  children: ReactNode;
  isAuthenticated: boolean;
  message: string;
}) {
  if (isAuthenticated) return children;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" align="center">
        {message}
      </TooltipContent>
    </Tooltip>
  );
}

function SkillSidebarDeferredStats({
  skill,
  owner,
  ownerHandle,
  formattedStats,
  latestVersion,
  showArchiveMetadata,
  securityAuditSummary,
  activityTrend,
  activityTrendLoading = false,
  hideCreator = false,
}: {
  skill: SkillDetailViewSkill;
  owner: PublicPublisher | null;
  ownerHandle: string | null;
  formattedStats: ReturnType<typeof formatSkillStatsTriplet>;
  latestVersion: SkillDetailLatestVersion;
  showArchiveMetadata: boolean;
  securityAuditSummary?: ReactNode;
  activityTrend?: ActivityTrend | null;
  activityTrendLoading?: boolean;
  hideCreator?: boolean;
}) {
  const githubRepositoryLink = getGitHubRepositoryLink(skill);
  const downloadsMetricBlock = useDownloadsSidebarMetricBlock({
    allTimeDownloads: skill.stats.downloads,
    activityTrend: activityTrend?.downloads,
    loading: activityTrendLoading,
  });

  return (
    <SidebarMetadata
      ariaLabel="Skill metadata"
      density="compact"
      className="skill-sidebar-deferred-metadata"
      blocks={[
        activityTrend || activityTrendLoading
          ? downloadsMetricBlock
          : {
              label: <ActivityMetricLabel label="Downloads" />,
              value: formattedStats.downloads,
              large: true,
            },
        { label: "Repository", value: githubRepositoryLink },
        ...(hideCreator
          ? []
          : [
              {
                label: "Creator",
                value: (
                  <UserBadge
                    user={owner}
                    fallbackHandle={ownerHandle}
                    prefix=""
                    size="md"
                    showName
                    showHandle={false}
                    showMutedHandle
                    disableTooltip
                  />
                ),
              },
            ]),
        securityAuditSummary
          ? {
              key: "security-audit",
              label: <DetailSecuritySummaryLabel />,
              value: securityAuditSummary,
            }
          : { label: "", value: null },
        ...(showArchiveMetadata
          ? [
              {
                grid: [
                  {
                    label: "Last updated",
                    value: (
                      <span title={new Date(skill.updatedAt).toLocaleString()}>
                        {timeAgo(skill.updatedAt)}
                      </span>
                    ),
                  },
                  {
                    label: "Current version",
                    value: latestVersion?.version ? `v${latestVersion.version}` : "None",
                  },
                ],
              },
              { label: "License", value: PLATFORM_SKILL_LICENSE },
            ]
          : [
              {
                label: "Last updated",
                value: (
                  <span title={new Date(skill.updatedAt).toLocaleString()}>
                    {timeAgo(skill.updatedAt)}
                  </span>
                ),
              },
            ]),
      ]}
    />
  );
}
