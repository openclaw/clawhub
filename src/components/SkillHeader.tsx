import { Link } from "@tanstack/react-router";
import type { ClawdisSkillMetadata } from "clawhub-schema";
import { PLATFORM_SKILL_LICENSE } from "clawhub-schema/licenseConstants";
import { Download, Flag, Settings, Star } from "lucide-react";
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
import { SkillInstallCard } from "./SkillInstallCard";
import { SkillCommandLineCard } from "./SkillInstallSurface";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

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

type SkillHeaderProps = {
  skill: Doc<"skills"> | PublicSkill;
  owner: PublicPublisher | null;
  ownerHandle: string | null;
  latestVersion: Doc<"skillVersions"> | null;
  modInfo: SkillModerationInfo | null;
  canManage: boolean;
  isAuthenticated: boolean;
  isStaff: boolean;
  isStarred: boolean | undefined;
  onToggleStar: () => void;
  onOpenReport?: (() => void) | null;
  forkOf: SkillFork | null;
  forkOfLabel: string;
  forkOfHref: string | null;
  forkOfOwnerHandle: string | null;
  canonical: SkillCanonical | null;
  canonicalHref: string | null;
  canonicalOwnerHandle: string | null;
  staffModerationNote: string | null;
  staffVisibilityTag: string | null;
  isAutoHidden: boolean;
  isRemoved: boolean;
  nixPlugin: string | undefined;
  hasPluginBundle: boolean;
  configRequirements: ClawdisSkillMetadata["config"] | undefined;
  cliHelp: string | undefined;
  clawdis: ClawdisSkillMetadata | undefined;
  osLabels: string[];
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
  canManage,
  isAuthenticated,
  isStaff,
  isStarred,
  onToggleStar,
  onOpenReport,
  forkOf,
  forkOfLabel,
  forkOfHref,
  forkOfOwnerHandle,
  canonical,
  canonicalHref,
  canonicalOwnerHandle,
  staffModerationNote,
  staffVisibilityTag,
  isAutoHidden,
  isRemoved,
  nixPlugin,
  hasPluginBundle,
  configRequirements,
  cliHelp,
  clawdis,
  osLabels,
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
    Boolean(downloadHref) || Boolean(onOpenReport) || isAuthenticated || Boolean(settingsHref);
  const badges = getSkillBadges(skill);
  const showHeroMeta = Boolean((forkOf && forkOfHref) || canonicalHref);
  const showHeroBadges = badges.length > 0 || Boolean(isStaff && staffVisibilityTag);

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
            {canManage ? (
              <p className="pending-banner-appeal">
                Review is a caution state, not a malicious block. Appeals are only available for
                skills marked malicious.
              </p>
            ) : null}
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
              formattedStats={formattedStats}
              latestVersion={latestVersion}
            />
            {hasSidebarActions ? (
              <div className="skill-sidebar-actions">
                {isAuthenticated ? (
                  <Button
                    variant="outline"
                    type="button"
                    className="skill-sidebar-action-button"
                    onClick={onToggleStar}
                    aria-pressed={Boolean(isStarred)}
                    aria-label={isStarred ? "Unstar skill" : "Star skill"}
                  >
                    <Star size={14} aria-hidden="true" fill={isStarred ? "currentColor" : "none"} />
                    {isStarred ? "Unstar" : "Star"}
                    <span className="skill-action-count">{formattedStats.stars}</span>
                  </Button>
                ) : null}
                {downloadHref ? (
                  <Button asChild variant="outline" className="skill-sidebar-action-button">
                    <a href={downloadHref}>
                      <Download size={14} aria-hidden="true" />
                      Download
                    </a>
                  </Button>
                ) : null}
                {onOpenReport ? (
                  <Button
                    variant="outline"
                    type="button"
                    className="skill-sidebar-action-button"
                    onClick={onOpenReport}
                  >
                    <Flag size={14} aria-hidden="true" />
                    Report
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
                <a href="/skills">skills</a>
                <span aria-hidden="true">/</span>
                <a href={buildSkillHref(ownerHandle, owner?._id ?? null, skill.slug)}>
                  {skill.slug}
                </a>
              </nav>
              <div className="skill-hero-title-row">
                <h1 className="skill-page-title">{skill.displayName}</h1>
                {nixPlugin ? <Badge variant="accent">Plugin bundle (nix)</Badge> : null}
                {hasTitleActions ? (
                  <div className="skill-title-actions">
                    {isStaff ? (
                      <Button asChild variant="outline" size="sm">
                        <Link to="/management" search={{ skill: skill.slug, plugin: undefined }}>
                          Manage
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <p className="section-subtitle">{skill.summary ?? "No summary provided."}</p>

              {isStaff && staffModerationNote ? (
                <div className="skill-hero-note">{staffModerationNote}</div>
              ) : null}
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

              {showHeroBadges ? (
                <div className="skill-hero-badges">
                  {badges.map((badge) => (
                    <Badge key={badge} variant="compact">
                      {badge}
                    </Badge>
                  ))}
                  {isStaff && staffVisibilityTag ? (
                    <Badge variant={isAutoHidden || isRemoved ? "accent" : "compact"}>
                      {staffVisibilityTag}
                    </Badge>
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
        <SkillInstallCard clawdis={clawdis} osLabels={osLabels} />
      </DetailHero>
    </>
  );
}

function SkillSidebarStats({
  skill,
  formattedStats,
  latestVersion,
}: {
  skill: Doc<"skills"> | PublicSkill;
  formattedStats: ReturnType<typeof formatSkillStatsTriplet>;
  latestVersion: Doc<"skillVersions"> | null;
}) {
  const versionCount = skill.stats.versions ?? 0;

  return (
    <SidebarMetadata
      ariaLabel="Skill metadata"
      blocks={[
        { label: "Installs", value: formattedStats.installsAllTime, large: true },
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
