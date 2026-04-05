import type { ClawdisSkillMetadata } from "clawhub-schema";
import { Link } from "@tanstack/react-router";
import {
  PLATFORM_SKILL_LICENSE,
  PLATFORM_SKILL_LICENSE_SUMMARY,
} from "clawhub-schema/licenseConstants";
import { Package } from "lucide-react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { getSkillBadges } from "../lib/badges";
import { formatCompactStat, formatSkillStatsTriplet } from "../lib/numberFormat";
import type { PublicPublisher, PublicSkill } from "../lib/publicUser";
import { getRuntimeEnv } from "../lib/runtimeEnv";
import { SkillInstallCard } from "./SkillInstallCard";
import { type LlmAnalysis, SecurityScanResults } from "./SkillSecurityScanResults";
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
  tagEntries: Array<[string, Id<"skillVersions">]>;
  versionById: Map<Id<"skillVersions">, Doc<"skillVersions">>;
  tagName: string;
  onTagNameChange: (value: string) => void;
  tagVersionId: Id<"skillVersions"> | "";
  onTagVersionChange: (value: Id<"skillVersions"> | "") => void;
  onTagSubmit: () => void;
  onTagDelete: (tag: string) => void;
  tagVersions: Doc<"skillVersions">[];
  clawdis: ClawdisSkillMetadata | undefined;
  osLabels: string[];
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
  tagEntries,
  versionById,
  tagName,
  onTagNameChange,
  tagVersionId,
  onTagVersionChange,
  onTagSubmit,
  onTagDelete,
  tagVersions,
  clawdis,
  osLabels,
}: SkillHeaderProps) {
  const convexSiteUrl = getRuntimeEnv("VITE_CONVEX_SITE_URL") ?? "https://clawhub.ai";
  const formattedStats = formatSkillStatsTriplet(skill.stats);
  const suppressScanResults =
    !isStaff &&
    Boolean(modInfo?.overrideActive) &&
    !modInfo?.isMalwareBlocked &&
    !modInfo?.isSuspicious;
  const overrideScanMessage = suppressScanResults
    ? "Security findings were reviewed by staff and cleared for public use."
    : null;

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
      ) : modInfo?.isMalwareBlocked ? (
        <div className="pending-banner pending-banner-blocked">
          <div className="pending-banner-content">
            <strong>Skill blocked — malicious content detected</strong>
            <p>
              ClawHub Security flagged this skill as malicious. Downloads are disabled. Review the
              scan results below.
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

      <div className="card skill-hero">
        <div className={`skill-hero-top${hasPluginBundle ? " has-plugin" : ""}`}>
          <div className="skill-hero-header">
            <div className="skill-hero-title">
              <div className="skill-hero-title-row">
                <h1 className="section-title" style={{ margin: 0 }}>
                  {skill.displayName}
                </h1>
                {latestVersion?.version ? (
                  <span className="plugin-version-badge">v{latestVersion.version}</span>
                ) : null}
                {nixPlugin ? <span className="tag tag-accent">Plugin bundle (nix)</span> : null}
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
                  <span className="stat">⭐ {formattedStats.stars}</span>
                  <span style={{ color: "var(--ink-soft)", opacity: 0.4 }}>·</span>
                  <span className="stat"><Package size={14} aria-hidden="true" /> {formattedStats.downloads}</span>
                  <span style={{ color: "var(--ink-soft)", opacity: 0.4 }}>·</span>
                  <span className="stat">{formatCompactStat(skill.stats.installsCurrent ?? 0)} current</span>
                  <span style={{ color: "var(--ink-soft)", opacity: 0.4 }}>·</span>
                  <span className="stat">{formattedStats.installsAllTime} all-time</span>
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
                      <span style={{ color: "var(--ink-soft)", opacity: 0.4 }}>·</span>
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
                      <span style={{ color: "var(--ink-soft)", opacity: 0.4 }}>·</span>
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
                <span className="tag tag-compact">{PLATFORM_SKILL_LICENSE}</span>
                {getSkillBadges(skill).map((badge) => (
                  <span key={badge} className="tag tag-compact">
                    {badge}
                  </span>
                ))}
                {isStaff && staffVisibilityTag ? (
                  <span className={`tag tag-compact${isAutoHidden || isRemoved ? " tag-accent" : ""}`}>
                    {staffVisibilityTag}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="skill-hero-sidebar">
              {!nixPlugin && !modInfo?.isMalwareBlocked && !modInfo?.isRemoved ? (
                <a
                  className="btn btn-primary"
                  href={`${convexSiteUrl}/api/v1/download?slug=${skill.slug}`}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  Download zip
                </a>
              ) : null}
              <div className="skill-hero-sidebar-meta">
                <div className="skill-sidebar-item">
                  <span className="skill-sidebar-label">License</span>
                  <span className="skill-sidebar-value">{PLATFORM_SKILL_LICENSE} · {PLATFORM_SKILL_LICENSE_SUMMARY}</span>
                </div>
              </div>
              <div className="skill-actions">
                {isAuthenticated ? (
                  <button
                    className={`star-toggle${isStarred ? " is-active" : ""}`}
                    type="button"
                    onClick={onToggleStar}
                    aria-label={isStarred ? "Unstar skill" : "Star skill"}
                  >
                    <span aria-hidden="true">★</span>
                  </button>
                ) : null}
                {isAuthenticated ? (
                  <button className="btn btn-sm btn-ghost" type="button" onClick={onOpenReport}>
                    Report
                  </button>
                ) : null}
                {isStaff ? (
                  <Link className="btn btn-sm" to="/management" search={{ skill: skill.slug }}>
                    Manage
                  </Link>
                ) : null}
              </div>
            </div>
          </div>

          {/* Security scan — full width below the header columns */}
          {suppressScanResults ? (
            <div className="skill-hero-note">{overrideScanMessage}</div>
          ) : latestVersion?.sha256hash ||
            latestVersion?.llmAnalysis ||
            (latestVersion?.staticScan?.findings?.length ?? 0) > 0 ||
            (latestVersion?.capabilityTags?.length ?? 0) > 0 ? (
            <div className="skill-hero-scan-row">
              <SecurityScanResults
                sha256hash={latestVersion?.sha256hash}
                vtAnalysis={latestVersion?.vtAnalysis}
                llmAnalysis={latestVersion?.llmAnalysis as LlmAnalysis | undefined}
                staticFindings={latestVersion?.staticScan?.findings}
                capabilityTags={latestVersion?.capabilityTags}
              />
              <p className="scan-disclaimer">
                Like a lobster shell, security has layers — review code before you run it.
              </p>
            </div>
          ) : null}
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

        <div className="skill-tag-row">
          {tagEntries.length === 0 ? (
            <span className="section-subtitle" style={{ margin: 0 }}>
              No tags yet.
            </span>
          ) : (
            tagEntries.map(([tag, versionId]) => (
              <span key={tag} className="tag">
                {tag}
                <span className="tag-meta">
                  v{versionById.get(versionId)?.version ?? versionId}
                </span>
                {canManage && tag !== "latest" ? (
                  <button
                    type="button"
                    className="tag-delete"
                    onClick={() => onTagDelete(tag)}
                    aria-label={`Delete tag ${tag}`}
                    title={`Delete tag "${tag}"`}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))
          )}
        </div>

        {canManage ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onTagSubmit();
            }}
            className="tag-form"
          >
            <input
              className="search-input"
              value={tagName}
              onChange={(event) => onTagNameChange(event.target.value)}
              placeholder="latest"
            />
            <select
              className="search-input"
              value={tagVersionId ?? ""}
              onChange={(event) => onTagVersionChange(event.target.value as Id<"skillVersions">)}
            >
              {tagVersions.map((version) => (
                <option key={version._id} value={version._id}>
                  v{version.version}
                </option>
              ))}
            </select>
            <button className="btn" type="submit">
              Update tag
            </button>
          </form>
        ) : null}

        <SkillInstallCard clawdis={clawdis} osLabels={osLabels} />
      </div>
    </>
  );
}
