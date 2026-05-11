import { Link } from "@tanstack/react-router";
import type { ClawdisSkillMetadata } from "clawhub-schema";
import { PLATFORM_SKILL_LICENSE } from "clawhub-schema/licenseConstants";
import { Download, Flag, Settings, ShieldCheck, Star } from "lucide-react";
import type { ReactNode } from "react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { getSkillBadges } from "../lib/badges";
import { formatSkillStatsTriplet } from "../lib/numberFormat";
import type { PublicPublisher, PublicSkill } from "../lib/publicUser";
import { getRuntimeEnv } from "../lib/runtimeEnv";
import { timeAgo } from "../lib/timeAgo";
import { DetailHero } from "./DetailPageShell";
import { SidebarMetadata } from "./SidebarMetadata";
import { buildSkillHref } from "./skillDetailUtils";
import { SkillCommandLineCard } from "./SkillInstallSurface";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { UserBadge } from "./UserBadge";
import { VerifiedBadge } from "./VerifiedBadge";

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
  priorityContent?: ReactNode;
  settingsHref?: string | null;
  children?: ReactNode;
};

export function SkillHeader({
  skill,
  owner,
  ownerHandle,
  latestVersion,
  modInfo,
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
  priorityContent,
  settingsHref,
  children,
}: SkillHeaderProps) {
  const formattedStats = formatSkillStatsTriplet(skill.stats);
  const installOwnerId = owner?._id ?? skill.ownerPublisherId ?? skill.ownerUserId ?? null;
  const convexSiteUrl = getRuntimeEnv("VITE_CONVEX_SITE_URL") ?? "https://clawhub.ai";
  const downloadHref =
    latestVersion && !nixPlugin
      ? `${convexSiteUrl}/api/v1/download?slug=${encodeURIComponent(skill.slug)}`
      : null;
  const hasTitleActions = isStaff;
  const hasSidebarActions =
    Boolean(downloadHref) || Boolean(onOpenReport) || Boolean(settingsHref) || hasTitleActions;
  const badges = getSkillBadges(skill);
  const showHeroMeta = Boolean((forkOf && forkOfHref) || canonicalHref);
  const showTitleBadges = badges.length > 0;
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
      ) : modInfo?.isSuspicious ? (
        <div className="pending-banner pending-banner-warning">
          <div className="pending-banner-content">
            <strong>Skill flagged — review recommended</strong>
            <p>
              ClawHub Security found sensitive or high-impact capabilities. Review the scan results
              before using.
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
                <a href={ownerHandle ? `/${encodeURIComponent(ownerHandle)}` : "#"}>
                  {ownerHandle ?? owner?.displayName ?? owner?._id ?? "unknown"}
                </a>
                <span aria-hidden="true">/</span>
                <a href={buildSkillHref(ownerHandle, owner?._id ?? null, skill.slug)}>
                  {skill.slug}
                </a>
              </nav>
              <div className="skill-hero-title-row">
                <h1 className="skill-page-title">{skill.displayName}</h1>
                {showTitleBadges ? (
                  <div className="skill-title-badges">
                    {badges.map((badge) =>
                      badge === "Verified" ? (
                        <VerifiedBadge key={badge} />
                      ) : (
                        <Badge key={badge} variant="compact">
                          {badge}
                        </Badge>
                      ),
                    )}
                  </div>
                ) : null}
                {nixPlugin ? <Badge variant="accent">Plugin bundle (nix)</Badge> : null}
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
}: {
  skill: Doc<"skills"> | PublicSkill;
  owner: PublicPublisher | null;
  ownerHandle: string | null;
  formattedStats: ReturnType<typeof formatSkillStatsTriplet>;
  latestVersion: SkillHeaderLatestVersion;
}) {
  const versionCount = skill.stats.versions ?? 0;

  return (
    <SidebarMetadata
      ariaLabel="Skill metadata"
      density="compact"
      blocks={[
        { label: "Downloads", value: formattedStats.downloads, large: true },
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
        {
          grid: [
            {
              label: "Current version",
              value: latestVersion?.version ? `v${latestVersion.version}` : "None",
            },
            { label: "Versions", value: versionCount },
          ],
        },
        {
          grid: [{ label: "License", value: PLATFORM_SKILL_LICENSE }],
        },
        { label: "Last updated", value: timeAgo(skill.updatedAt) },
      ]}
    />
  );
}
