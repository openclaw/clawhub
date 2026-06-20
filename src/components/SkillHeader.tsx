import { Link } from "@tanstack/react-router";
import type { ClawdisSkillMetadata } from "clawhub-schema";
import { PLATFORM_SKILL_LICENSE } from "clawhub-schema/licenseConstants";
import { Download, Flag, Settings, ShieldCheck, Star, Upload } from "lucide-react";
import type { ReactNode } from "react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { ActivityTrend } from "../lib/activityTrend";
import { getSkillBadges } from "../lib/badges";
import { buildSkillCategoryBrowseHref, type SkillCategory } from "../lib/categories";
import { formatSkillStatsTriplet } from "../lib/numberFormat";
import type { PublicPublisher, PublicSkill } from "../lib/publicUser";
import { getRuntimeEnv } from "../lib/runtimeEnv";
import { timeAgo } from "../lib/timeAgo";
import { ActivityMetricLabel } from "./ActivityMetricLabel";
import { CatalogTopicList } from "./CatalogTopicList";
import { DetailHero } from "./DetailPageShell";
import { DetailSecuritySummaryLabel } from "./DetailSecuritySummary";
import { MetricTrendCard, MetricTrendCardSkeleton } from "./MetricTrendCard";
import { OfficialTag } from "./OfficialBadge";
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
  overrideActive?: boolean;
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

type SkillHeaderLatestVersion =
  | (Omit<Doc<"skillVersions">, "parsed"> & {
      parsed?: (Partial<Doc<"skillVersions">["parsed"]> & { description?: string }) | null;
    })
  | null;

function getLatestVersionDescription(latestVersion: SkillHeaderLatestVersion) {
  const parsed = latestVersion?.parsed;
  const description =
    typeof parsed?.description === "string"
      ? parsed.description
      : typeof parsed?.frontmatter?.description === "string"
        ? parsed.frontmatter.description
        : null;
  return description?.trim() || null;
}

function buildSkillDownloadHref(convexSiteUrl: string, slug: string, ownerHandle: string | null) {
  const params = new URLSearchParams({ slug });
  const normalizedOwner = ownerHandle?.trim().replace(/^@+/, "");
  if (normalizedOwner) params.set("ownerHandle", normalizedOwner);
  return `${convexSiteUrl}/api/v1/download?${params.toString()}`;
}

function getGitHubRepositoryLink(skill: Doc<"skills"> | PublicSkill) {
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

type SkillHeaderProps = {
  skill: Doc<"skills"> | PublicSkill;
  owner: PublicPublisher | null;
  ownerHandle: string | null;
  latestVersion: SkillHeaderLatestVersion;
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
  priorityContent?: ReactNode;
  postInstallContent?: ReactNode;
  securityAuditSummary?: ReactNode;
  activityTrend?: ActivityTrend | null;
  activityTrendLoading?: boolean;
  newVersionHref?: string | null;
  settingsHref?: string | null;
  showArchiveMetadata?: boolean;
  children?: ReactNode;
};

export function SkillHeader({
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
  priorityContent,
  postInstallContent,
  securityAuditSummary,
  activityTrend,
  activityTrendLoading = false,
  newVersionHref,
  settingsHref,
  showArchiveMetadata = true,
  children,
}: SkillHeaderProps) {
  const formattedStats = formatSkillStatsTriplet(skill.stats);
  const installOwnerId = owner?._id ?? skill.ownerPublisherId ?? skill.ownerUserId ?? null;
  const convexSiteUrl = getRuntimeEnv("VITE_CONVEX_SITE_URL") ?? "https://clawhub.ai";
  const downloadHref =
    latestVersion && !nixPlugin
      ? buildSkillDownloadHref(convexSiteUrl, skill.slug, ownerHandle)
      : null;
  const hasTitleActions = isStaff;
  const showReportAction = !canManage || isStaff;
  const hasSidebarActions =
    Boolean(downloadHref) ||
    showReportAction ||
    Boolean(newVersionHref) ||
    Boolean(settingsHref) ||
    hasTitleActions;
  const badges = getSkillBadges(skill);
  const isOfficial = badges.includes("Official") || owner?.official === true;
  const titleBadges = badges.filter((badge) => badge !== "Official");
  const showHeroMeta = Boolean((forkOf && forkOfHref) || canonicalHref);
  const showTitleBadges = titleBadges.length > 0;
  const headerDescription =
    getLatestVersionDescription(latestVersion) ?? skill.summary ?? "No summary provided.";

  return (
    <>
      {modInfo?.isPendingScan ? (
        <div className="pending-banner">
          <div className="pending-banner-content">
            <strong>Security scan in progress</strong>
            <p>
              Your skill is being scanned by VirusTotal. It will be visible to others once the scan
              completes. This usually takes up to 5 minutes — grab a coffee or exfoliate your shell
              while you wait.
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

      <DetailHero
        topClassName={hasPluginBundle ? "has-plugin" : undefined}
        sidebar={
          <div className="skill-hero-sidebar-stack">
            <SkillSidebarStats
              skill={skill}
              owner={owner}
              ownerHandle={ownerHandle}
              formattedStats={formattedStats}
              latestVersion={latestVersion}
              showArchiveMetadata={showArchiveMetadata}
              securityAuditSummary={securityAuditSummary}
              activityTrend={activityTrend}
              activityTrendLoading={activityTrendLoading}
            />
            {hasSidebarActions ? (
              <div className="skill-sidebar-actions">
                <SignedInActionTooltip
                  isAuthenticated={isAuthenticated}
                  message="You must be signed in to star a skill"
                >
                  <Button
                    variant="outline"
                    type="button"
                    className="skill-sidebar-action-button"
                    onClick={isAuthenticated ? onToggleStar : onRequireSignIn}
                    aria-pressed={Boolean(isAuthenticated && isStarred)}
                    aria-label={isStarred ? "Unstar skill" : "Star skill"}
                  >
                    <Star
                      size={14}
                      aria-hidden="true"
                      fill={isAuthenticated && isStarred ? "currentColor" : "none"}
                    />
                    {isAuthenticated && isStarred ? "Unstar" : "Star"}
                    <span className="skill-action-count">{formattedStats.stars}</span>
                  </Button>
                </SignedInActionTooltip>
                {downloadHref ? (
                  <Button asChild variant="outline" className="skill-sidebar-action-button">
                    <a href={downloadHref}>
                      <Download size={14} aria-hidden="true" />
                      Download
                    </a>
                  </Button>
                ) : null}
                {showReportAction ? (
                  <SignedInActionTooltip
                    isAuthenticated={isAuthenticated}
                    message="You must be signed in to report a skill"
                  >
                    <Button
                      variant="outline"
                      type="button"
                      className="skill-sidebar-action-button"
                      onClick={isAuthenticated ? onOpenReport : onRequireSignIn}
                    >
                      <Flag size={14} aria-hidden="true" />
                      Report
                    </Button>
                  </SignedInActionTooltip>
                ) : null}
                {newVersionHref ? (
                  <Button asChild variant="outline" className="skill-sidebar-action-button">
                    <a href={newVersionHref}>
                      <Upload size={14} aria-hidden="true" />
                      New version
                    </a>
                  </Button>
                ) : null}
                {settingsHref ? (
                  <Button asChild variant="outline" className="skill-sidebar-action-button">
                    <a href={settingsHref}>
                      <Settings size={14} aria-hidden="true" />
                      Settings
                    </a>
                  </Button>
                ) : null}
                {hasTitleActions ? (
                  <>
                    {isStaff ? (
                      <Button asChild variant="outline" className="skill-sidebar-action-button">
                        <Link to="/management" search={{ skill: skill.slug, plugin: undefined }}>
                          <ShieldCheck size={14} aria-hidden="true" />
                          Manage
                        </Link>
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        }
        main={
          <>
            <div className="skill-hero-title">
              <nav className="skill-hero-breadcrumbs" aria-label="Skill breadcrumbs">
                <a href="/skills">skills</a>
                <span aria-hidden="true">/</span>
                <a href={ownerHandle ? `/user/${encodeURIComponent(ownerHandle)}` : "#"}>
                  {ownerHandle ?? owner?.displayName ?? owner?._id ?? "unknown"}
                </a>
                <span aria-hidden="true">/</span>
                <a href={buildSkillHref(ownerHandle, owner?._id ?? null, skill.slug)}>
                  {skill.slug}
                </a>
              </nav>
              <div className="skill-hero-heading-stack">
                <div className="skill-hero-title-row">
                  <h1 className="skill-page-title">{skill.displayName}</h1>
                  {isOfficial ? <OfficialTag /> : null}
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
                </div>
                {category ? (
                  <a
                    className="skill-category-chip"
                    href={buildSkillCategoryBrowseHref(category)}
                    aria-label={`View ${category.label} skills`}
                  >
                    {category.label}
                  </a>
                ) : null}
                <CatalogTopicList topics={skill.topics} />
              </div>
              <div className="skill-summary-block">
                <p className="section-subtitle skill-summary-line">{headerDescription}</p>
              </div>

              {nixPlugin ? (
                <div className="skill-hero-note">
                  Bundles the skill pack, CLI binary, and config requirements in one Nix install.
                </div>
              ) : null}

              {showHeroMeta ? (
                <div className="skill-hero-meta-row">
                  {forkOf && forkOfHref ? (
                    <span className="stat">
                      {forkOfLabel}{" "}
                      <a href={forkOfHref}>
                        {forkOfOwnerHandle ? `@${forkOfOwnerHandle}/` : ""}
                        {forkOf.skill.slug}
                      </a>
                      {forkOf.version ? ` (${forkOf.version})` : null}
                    </span>
                  ) : null}
                  {canonicalHref ? (
                    <>
                      {forkOf && forkOfHref ? (
                        <span className="text-ink-soft opacity-40">·</span>
                      ) : null}
                      <span className="stat">
                        canonical:{" "}
                        <a href={canonicalHref}>
                          {canonicalOwnerHandle ? `@${canonicalOwnerHandle}/` : ""}
                          {canonical?.skill?.slug}
                        </a>
                      </span>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        }
      >
        {priorityContent}

        <SkillCommandLineCard
          slug={skill.slug}
          displayName={skill.displayName}
          ownerHandle={ownerHandle}
          ownerId={installOwnerId}
          clawdis={clawdis}
        />

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
      </DetailHero>
    </>
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

function SkillSidebarStats({
  skill,
  owner,
  ownerHandle,
  formattedStats,
  latestVersion,
  showArchiveMetadata,
  securityAuditSummary,
  activityTrend,
  activityTrendLoading = false,
}: {
  skill: Doc<"skills"> | PublicSkill;
  owner: PublicPublisher | null;
  ownerHandle: string | null;
  formattedStats: ReturnType<typeof formatSkillStatsTriplet>;
  latestVersion: SkillHeaderLatestVersion;
  showArchiveMetadata: boolean;
  securityAuditSummary?: ReactNode;
  activityTrend?: ActivityTrend | null;
  activityTrendLoading?: boolean;
}) {
  const githubRepositoryLink = getGitHubRepositoryLink(skill);

  return (
    <SidebarMetadata
      ariaLabel="Skill metadata"
      density="compact"
      blocks={[
        activityTrendLoading
          ? {
              key: "download-trend-loading",
              label: <ActivityMetricLabel label="30-day Downloads" />,
              value: <MetricTrendCardSkeleton />,
              large: true,
            }
          : activityTrend
            ? {
                key: "download-trend",
                label: <ActivityMetricLabel label="30-day Downloads" />,
                value: (
                  <MetricTrendCard
                    trend={activityTrend.downloads}
                    ariaLabel="Daily downloads over the last 30 days"
                    unitLabel="download"
                  />
                ),
                large: true,
              }
            : {
                label: <ActivityMetricLabel label="Downloads" />,
                value: formattedStats.downloads,
                large: true,
              },
        { label: "Repository", value: githubRepositoryLink },
        {
          label: "Owner",
          value: (
            <UserBadge
              user={owner}
              fallbackHandle={ownerHandle}
              prefix=""
              size="md"
              showName
              showHandle={false}
              disableTooltip
            />
          ),
        },
        securityAuditSummary
          ? {
              key: "security-audit",
              label: <DetailSecuritySummaryLabel />,
              value: securityAuditSummary,
            }
          : { label: "", value: null },
        { label: "Last updated", value: timeAgo(skill.updatedAt) },
        ...(showArchiveMetadata
          ? [
              {
                grid: [
                  {
                    label: "Current version",
                    value: latestVersion?.version ? `v${latestVersion.version}` : "None",
                  },
                  { label: "License", value: PLATFORM_SKILL_LICENSE },
                ],
              },
            ]
          : []),
      ]}
    />
  );
}
