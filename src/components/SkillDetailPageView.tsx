import { Link } from "@tanstack/react-router";
import type { ClawdisSkillMetadata } from "clawhub-schema";
import { getSkillReleaseScanStatus, normalizeSecurityStatus } from "clawhub-schema/securityAudit";
import { Bookmark, BookOpenText, Flag, Settings, ShieldCheck, Upload } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { SkillPublicationProgress } from "../../convex/lib/skillPublicationProgress";
import { getSkillBadges, isSkillOfficial } from "../lib/badges";
import { BrowseCategoryIcon } from "../lib/browseCategoryIcons";
import {
  buildSkillCategoryBrowseHref,
  buildSkillTopicBrowseHref,
  formatCatalogTopicLabel,
  type SkillCategory,
} from "../lib/categories";
import { formatCompactStat } from "../lib/numberFormat";
import { buildPublisherProfileHref } from "../lib/ownerRoute";
import { presentationTitle } from "../lib/presentationTitle";
import type { PublicPublisher, PublicSkill } from "../lib/publicUser";
import { getClawHubSiteUrl } from "../lib/site";
import { cn } from "../lib/utils";
import { CatalogDetailLayout, CatalogDetailBreadcrumb } from "./CatalogDetailLayout";
import { DETAIL_HERO_TOPIC_LIMIT } from "./DetailPageShell";
import { InlineMarkdownSummary } from "./InlineMarkdownSummary";
import { OfficialBadge } from "./OfficialBadge";
import { SkillCatalogFacts } from "./SkillCatalogFacts";
import { buildSkillInstallTarget } from "./skillDetailUtils";
import { SkillCommandLineCard } from "./SkillInstallSurface";
import { SkillPublicationNotice } from "./SkillPublicationNotice";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import "./skill-catalog-detail.css";

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
      data-analytics-public-detail=""
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
  isPendingPublication?: boolean;
  publicationProgress?: SkillPublicationProgress | null;
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
  category?: SkillCategory | null;
  categories?: SkillCategory[] | null;
  staffVisibilityAlert?: ReactNode;
  postInstallContent?: ReactNode;
  securityAuditHref?: string;
  overview?: ReactNode;
  versionHistory?: ReactNode;
  footer?: ReactNode;
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
  isPendingPublication = false,
  publicationProgress = null,
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
  category,
  categories,
  staffVisibilityTag,
  isAutoHidden,
  isRemoved,
  staffVisibilityAlert,
  postInstallContent,
  securityAuditHref,
  overview,
  versionHistory,
  footer,
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
  const installOwnerId = owner?._id ?? skill.ownerPublisherId ?? skill.ownerUserId ?? null;
  const hasOwnerActions = Boolean(newVersionHref) || Boolean(settingsHref);
  const showReportAction = showReportActionOverride ?? (!canManage || isStaff);
  const badges = getSkillBadges(skill);
  const titleBadges = badges.filter((badge) => badge !== "Official");
  const officialSkill = isSkillOfficial(skill);
  const showHeroMeta = Boolean((forkOf && forkOfHref) || canonicalHref);
  const showTitleBadges = titleBadges.length > 0;
  const headerDescription = skill.summary?.trim() || getLatestVersionDescription(latestVersion);
  const headerTopics = (skill.topics ?? [])
    .map((topic) => topic.trim())
    .filter(Boolean)
    .slice(0, DETAIL_HERO_TOPIC_LIMIT);
  const headerCategories = (categories ?? (category ? [category] : [])).slice(0, 3);

  // Do not fall back to a globally ambiguous slug, a display name or an owner ID.
  const appInstallTarget = ownerHandle?.trim()
    ? buildSkillInstallTarget(ownerHandle, installOwnerId, skill.slug)
    : null;
  const canOpenInstall = Boolean(
    appInstallTarget &&
    latestVersion &&
    skill.installKind !== "github" &&
    installContent === undefined &&
    !isPendingPublication &&
    !isRemoved &&
    !isAutoHidden &&
    !staffVisibilityTag &&
    !modInfo?.isPendingScan &&
    !modInfo?.isMalwareBlocked &&
    !modInfo?.isHiddenByMod &&
    !modInfo?.isRemoved &&
    modInfo?.verdict !== "malicious",
  );
  const installCommandCard = !isPendingPublication
    ? (installContent ?? (
        <SkillCommandLineCard
          slug={skill.slug}
          ownerHandle={ownerHandle}
          ownerId={installOwnerId}
          desktopInstall={
            canOpenInstall && appInstallTarget
              ? { family: "skills", name: appInstallTarget }
              : undefined
          }
        />
      ))
    : null;

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
        <span className="skill-action-count">{formatCompactStat(skill.stats.stars)}</span>
      </button>
    </SignedInActionTooltip>
  );

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

  const displayName = presentationTitle(skill.displayName, skill.slug);
  const profileHref =
    breadcrumbOwnerHref === undefined && ownerHandle
      ? buildPublisherProfileHref(ownerHandle)
      : breadcrumbOwnerHref;
  const scanStatus = latestVersion
    ? getSkillReleaseScanStatus(latestVersion)
    : skill.installKind === "github" && skill.githubScanStatus
      ? normalizeSecurityStatus(skill.githubScanStatus)
      : null;
  const repository = getGitHubRepositoryLink(skill);
  const linkedIdentity = ownerHandle || owner?.displayName;
  const platforms = (latestVersion?.parsed?.clawdis as ClawdisSkillMetadata | undefined)?.os;
  const fullDescription = getLatestVersionDescription(latestVersion);
  const identity = (
    <>
      {owner?.displayName && (
        <strong className="skill-catalog-owner-name">{owner.displayName}</strong>
      )}
      {ownerHandle && <span className="skill-catalog-owner-handle">@{ownerHandle}</span>}
    </>
  );

  const metadata = (
    <>
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

      {taxonomyPrefix || headerCategories.length > 0 || headerTopics.length > 0 ? (
        <div
          className="skill-hero-taxonomy-row"
          aria-label={renderSidebarContent ? "Skill metadata" : "Skill taxonomy"}
        >
          {taxonomyPrefix ? (
            <div className="skill-hero-taxonomy-prefix">{taxonomyPrefix}</div>
          ) : null}
          {taxonomyPrefix && (headerCategories.length > 0 || headerTopics.length > 0) ? (
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

      {fullDescription && fullDescription !== headerDescription && (
        <details className="skill-catalog-more">
          <summary>Full description</summary>
          <p data-analytics-public-detail="">
            <InlineMarkdownSummary>{fullDescription}</InlineMarkdownSummary>
          </p>
        </details>
      )}
    </>
  );
  return (
    <main className={cn("catalog-detail-page skill-detail-page skill-catalog-page", pageClassName)}>
      {publicationProgress ? (
        <SkillPublicationNotice
          progress={publicationProgress}
          publishedVersion={latestVersion?.version}
        />
      ) : isPendingPublication ? (
        <div className="pending-banner">
          <div className="pending-banner-content">
            <strong>Pending publication</strong>
            <p>
              This skill is visible to its publisher and ClawHub staff, but not yet public or
              installable. ClawHub is completing security and publication checks.
            </p>
          </div>
        </div>
      ) : modInfo?.isPendingScan ? (
        <div className="pending-banner">
          <div className="pending-banner-content">
            <strong>Security scan in progress</strong>
            <p>
              Your skill is undergoing security checks. It will be visible to others once the checks
              complete.
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

      <CatalogDetailLayout
        className="skill-catalog-detail"
        footer={
          renderSidebarContent ? (
            footer
          ) : (
            <>
              {footer}
              {(repository ||
                versionHistory ||
                showBookmarkAction ||
                showReportAction ||
                (!scanStatus && securityAuditHref)) && (
                <div
                  className="skill-catalog-secondary-actions"
                  role="group"
                  aria-label="Skill actions"
                >
                  {repository && <span>Repository: {repository}</span>}
                  {!scanStatus && securityAuditHref && (
                    <a className="skill-sidebar-action-link" href={securityAuditHref}>
                      Full security report
                    </a>
                  )}
                  {versionHistory}
                  {showBookmarkAction && renderStarAction()}
                  {showReportAction && (
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
                  )}
                </div>
              )}
            </>
          )
        }
        breadcrumb={
          breadcrumbSkillHref ? (
            <nav className="catalog-detail__breadcrumb" aria-label="Skill breadcrumbs">
              <a href="/skills">Skills</a>
              <span aria-hidden="true">/</span>
              {breadcrumbOwnerLabel}
              <span aria-hidden="true">/</span>
              <a href={breadcrumbSkillHref} aria-current="page">
                {skill.slug}
              </a>
            </nav>
          ) : (
            <CatalogDetailBreadcrumb href="/skills" label="Skills" current={displayName} />
          )
        }
        icon={
          <SkillCatalogTile
            key={`${skill.icon ?? ""}-${owner?.image ?? ""}`}
            icon={skill.icon}
            profileImage={owner?.image}
          />
        }
        title={displayName}
        publisher={
          <>
            {creatorContent ? (
              <div className="skill-hero-creator">{creatorContent}</div>
            ) : linkedIdentity ? (
              <span className="skill-catalog-byline" data-analytics-public-detail="">
                {officialSkill ? <OfficialBadge iconOnly size={14} /> : null}
                {profileHref ? (
                  <a
                    aria-label={`View ${ownerHandle ?? owner?.displayName} profile`}
                    href={profileHref}
                  >
                    {identity}
                  </a>
                ) : (
                  identity
                )}
              </span>
            ) : null}
            {showTitleBadges &&
              titleBadges.map((badge) => (
                <Badge key={badge} variant="compact">
                  {badge}
                </Badge>
              ))}
            {nixPlugin ? <Badge variant="accent">Plugin bundle (nix)</Badge> : null}
            {titleAccessory}
          </>
        }
        summary={
          headerDescription && (
            <span data-analytics-public-detail="">
              <InlineMarkdownSummary>{headerDescription}</InlineMarkdownSummary>
            </span>
          )
        }
        sidebar={
          <>
            {installCommandCard}
            {renderSidebarContent ? (
              renderSidebarContent()
            ) : (
              <SkillCatalogFacts
                status={scanStatus}
                auditHref={securityAuditHref}
                version={showArchiveMetadata ? latestVersion?.version : undefined}
                updatedAt={skill.updatedAt}
                license={showArchiveMetadata ? latestVersion?.parsed?.license : undefined}
                platforms={platforms}
              />
            )}
          </>
        }
      >
        {heroNotice}
        {overview}
        {postInstallContent}
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

        {nixPlugin && (
          <p>Bundles the skill pack, CLI binary, and config requirements in one Nix install.</p>
        )}
        {metadata}
        {children}
      </CatalogDetailLayout>
      {pageOverlays}
    </main>
  );
}

function skillCatalogImage(value?: string | null) {
  if (!value) return null;
  try {
    const registry = getClawHubSiteUrl();
    const url = new URL(value, registry);
    return url.origin === registry &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/api\/v1\/skill-icons\/[a-f\d]{64}$/u.test(url.pathname)
      ? url.pathname
      : null;
  } catch {
    return null;
  }
}

function SkillCatalogTile({
  icon,
  profileImage,
}: {
  icon?: string | null;
  profileImage?: string | null;
}) {
  // The Control UI registry adapter admits only same-registry, content-addressed
  // art, including for the publisher fallback. Third-party avatars are not skill icons.
  const [failed, setFailed] = useState<string[]>([]);
  const candidates = [skillCatalogImage(icon), skillCatalogImage(profileImage)];
  const src = candidates.find((candidate) => candidate && !failed.includes(candidate));
  const hosted = src && src === candidates[0];
  return (
    <span
      className={cn("skill-catalog-tile", !hosted && src && "skill-catalog-tile--profile")}
      aria-hidden="true"
    >
      {src ? (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed((old) => [...old, src])}
        />
      ) : (
        <BookOpenText size={26} />
      )}
    </span>
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
