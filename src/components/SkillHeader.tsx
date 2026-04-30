import { Link } from "@tanstack/react-router";
import type { ClawdisSkillMetadata } from "clawhub-schema";
import { PLATFORM_SKILL_LICENSE } from "clawhub-schema/licenseConstants";
import { Calendar, Download, History, Package, Scale, Settings, Star, Upload } from "lucide-react";
import type { ReactNode } from "react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { getSkillBadges } from "../lib/badges";
import { formatCompactStat, formatSkillStatsTriplet } from "../lib/numberFormat";
import type { PublicPublisher, PublicSkill } from "../lib/publicUser";
import { timeAgo } from "../lib/timeAgo";
import { DetailHero } from "./DetailPageShell";
import { SkillInstallCard } from "./SkillInstallCard";
import { SkillCommandLineCard } from "./SkillInstallSurface";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { UserBadge } from "./UserBadge";

export type SkillModerationInfo = {
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
  onOpenReport: () => void;
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
            <strong>Skill flagged — suspicious patterns detected</strong>
            <p>
              ClawHub Security flagged this skill as suspicious. Review the scan results before
              using.
            </p>
            {canManage ? (
              <p className="pending-banner-appeal">
                If you believe this skill has been incorrectly flagged, please{" "}
                <a
                  href="https://github.com/openclaw/clawhub/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  submit an issue on GitHub
                </a>{" "}
                and we'll break down why it was flagged and what you can do.
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
        main={
          <>
            <div className="skill-hero-title">
              <div className="skill-hero-title-row">
                <h1 className="skill-page-title">{skill.displayName}</h1>
                {latestVersion?.version ? (
                  <span className="plugin-version-badge">v{latestVersion.version}</span>
                ) : null}
                {nixPlugin ? <Badge variant="accent">Plugin bundle (nix)</Badge> : null}
                {isAuthenticated || canManage || isStaff || settingsHref ? (
                  <div className="skill-title-actions">
                    {isAuthenticated ? (
                      <>
                        <button
                          className={`star-toggle${isStarred ? " is-active" : ""}`}
                          type="button"
                          onClick={onToggleStar}
                          aria-label={isStarred ? "Unstar skill" : "Star skill"}
                        >
                          <Star size={16} aria-hidden="true" />
                        </button>
                        <Button variant="ghost" size="sm" type="button" onClick={onOpenReport}>
                          Report
                        </Button>
                      </>
                    ) : null}
                    {isStaff ? (
                      <Button asChild variant="outline" size="sm">
                        <Link to="/management" search={{ skill: skill.slug, plugin: undefined }}>
                          Manage
                        </Link>
                      </Button>
                    ) : null}
                    {canManage ? (
                      <Button asChild variant="outline" size="sm" className="skill-settings-link">
                        <Link to="/publish-skill" search={{ updateSlug: skill.slug }}>
                          <Upload size={14} aria-hidden="true" />
                          New Version
                        </Link>
                      </Button>
                    ) : null}
                    {settingsHref ? (
                      <Button asChild variant="outline" size="sm" className="skill-settings-link">
                        <a href={settingsHref}>
                          <Settings size={14} aria-hidden="true" />
                          Settings
                        </a>
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

              <div className="skill-hero-inline-meta">
                <div className="skill-hero-stats-row">
                  <span className="stat">
                    <Star size={14} aria-hidden="true" /> {formattedStats.stars}
                  </span>
                  <span className="text-ink-soft opacity-40">·</span>
                  <span className="stat">
                    <Download size={14} aria-hidden="true" /> {formattedStats.downloads}
                  </span>
                  <span className="text-ink-soft opacity-40">·</span>
                  <span className="stat">
                    <Package size={14} aria-hidden="true" /> {skill.stats.versions ?? 0} versions
                  </span>
                  <span className="text-ink-soft opacity-40">·</span>
                  <span className="stat">
                    <History size={14} aria-hidden="true" />{" "}
                    {formatCompactStat(skill.stats.installsCurrent ?? 0)} current
                  </span>
                  <span className="text-ink-soft opacity-40">·</span>
                  <span className="stat">
                    <History size={14} aria-hidden="true" /> {formattedStats.installsAllTime}{" "}
                    all-time
                  </span>
                  <span className="text-ink-soft opacity-40">·</span>
                  <span className="stat">
                    <Calendar size={14} aria-hidden="true" /> Updated {timeAgo(skill.updatedAt)}
                  </span>
                  <span className="text-ink-soft opacity-40">·</span>
                  <span className="stat">
                    <Scale size={14} aria-hidden="true" /> {PLATFORM_SKILL_LICENSE}
                  </span>
                </div>
                <div className="skill-hero-meta-row">
                  <UserBadge
                    user={owner}
                    fallbackHandle={ownerHandle}
                    prefix="by"
                    size="md"
                    showName
                  />
                  {forkOf && forkOfHref ? (
                    <>
                      <span className="text-ink-soft opacity-40">·</span>
                      <span className="stat">
                        {forkOfLabel}{" "}
                        <a href={forkOfHref}>
                          {forkOfOwnerHandle ? `@${forkOfOwnerHandle}/` : ""}
                          {forkOf.skill.slug}
                        </a>
                        {forkOf.version ? ` (${forkOf.version})` : null}
                      </span>
                    </>
                  ) : null}
                  {canonicalHref ? (
                    <>
                      <span className="text-ink-soft opacity-40">·</span>
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
              </div>

              <div className="skill-hero-badges">
                {getSkillBadges(skill).map((badge) => (
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
            </div>
          </>
        }
      >
        <div className="skill-hero-action-grid">
          {priorityContent}
          <SkillCommandLineCard
            slug={skill.slug}
            displayName={skill.displayName}
            ownerHandle={ownerHandle}
            ownerId={installOwnerId}
            clawdis={clawdis}
          />
        </div>

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
