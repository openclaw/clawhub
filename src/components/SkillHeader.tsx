import { Link } from "@tanstack/react-router";
import type { ClawdisSkillMetadata } from "clawhub-schema";
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
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
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
        <div className="rounded-[var(--radius-md)] border border-amber-300/50 bg-amber-50 p-5 dark:border-amber-500/30 dark:bg-amber-950/40">
          <div className="flex flex-col gap-2">
            <strong>Security scan in progress</strong>
            <p>
              Your skill is being scanned by VirusTotal. It will be visible to others once the scan
              completes. This usually takes up to 5 minutes — grab a coffee or exfoliate your shell
              while you wait.
            </p>
          </div>
        </div>
      ) : modInfo?.isMalwareBlocked ? (
        <div className="rounded-[var(--radius-md)] border border-red-300/50 bg-red-50 p-5 dark:border-red-500/30 dark:bg-red-950/40">
          <div className="flex flex-col gap-2">
            <strong>Skill blocked — malicious content detected</strong>
            <p>
              ClawHub Security flagged this skill as malicious. Downloads are disabled. Review the
              scan results below.
            </p>
          </div>
        </div>
      ) : modInfo?.isSuspicious ? (
        <div className="rounded-[var(--radius-md)] border border-amber-300/50 bg-amber-50 p-5 dark:border-amber-500/30 dark:bg-amber-950/40">
          <div className="flex flex-col gap-2">
            <strong>Skill flagged — suspicious patterns detected</strong>
            <p>
              ClawHub Security flagged this skill as suspicious. Review the scan results before
              using.
            </p>
            {canManage ? (
              <p className="text-sm text-[color:var(--ink-soft)]">
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
        <div className="rounded-[var(--radius-md)] border border-red-300/50 bg-red-50 p-5 dark:border-red-500/30 dark:bg-red-950/40">
          <div className="flex flex-col gap-2">
            <strong>Skill removed by moderator</strong>
            <p>This skill has been removed and is not visible to others.</p>
          </div>
        </div>
      ) : modInfo?.isHiddenByMod ? (
        <div className="rounded-[var(--radius-md)] border border-red-300/50 bg-red-50 p-5 dark:border-red-500/30 dark:bg-red-950/40">
          <div className="flex flex-col gap-2">
            <strong>Skill hidden</strong>
            <p>This skill is currently hidden and not visible to others.</p>
          </div>
        </div>
      ) : null}

      <Card>
        <div className={`flex flex-col gap-5${hasPluginBundle ? " pb-2" : ""}`}>
          <div className="flex flex-col gap-5 md:flex-row md:gap-8">
            <div className="flex flex-1 flex-col gap-3">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="m-0 font-display text-lg font-bold text-[color:var(--ink)]">
                    {skill.displayName}
                  </h1>
                  {latestVersion?.version ? (
                    <Badge variant="compact">v{latestVersion.version}</Badge>
                  ) : null}
                  {nixPlugin ? <Badge variant="accent">Plugin bundle (nix)</Badge> : null}
                </div>
                <p className="m-0 text-sm text-[color:var(--ink-soft)]">
                  {skill.summary ?? "No summary provided."}
                </p>

                {isStaff && staffModerationNote ? (
                  <div className="rounded-[var(--radius-sm)] border border-amber-200/60 bg-amber-50/60 px-3 py-2 text-sm text-[color:var(--ink-soft)] dark:border-amber-500/20 dark:bg-amber-950/30">
                    {staffModerationNote}
                  </div>
                ) : null}
                {nixPlugin ? (
                  <div className="rounded-[var(--radius-sm)] border border-amber-200/60 bg-amber-50/60 px-3 py-2 text-sm text-[color:var(--ink-soft)] dark:border-amber-500/20 dark:bg-amber-950/30">
                    Bundles the skill pack, CLI binary, and config requirements in one Nix install.
                  </div>
                ) : null}

                <div className="flex flex-col gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-[color:var(--ink-soft)]">
                      ⭐ {formattedStats.stars}
                    </span>
                    <span className="text-[color:var(--ink-soft)] opacity-40">·</span>
                    <span className="flex items-center gap-1 text-sm text-[color:var(--ink-soft)]">
                      <Package size={14} aria-hidden="true" /> {formattedStats.downloads}
                    </span>
                    <span className="text-[color:var(--ink-soft)] opacity-40">·</span>
                    <span className="text-sm text-[color:var(--ink-soft)]">
                      {formatCompactStat(skill.stats.installsCurrent ?? 0)} current
                    </span>
                    <span className="text-[color:var(--ink-soft)] opacity-40">·</span>
                    <span className="text-sm text-[color:var(--ink-soft)]">
                      {formattedStats.installsAllTime} all-time
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <UserBadge
                      user={owner}
                      fallbackHandle={ownerHandle}
                      prefix="by"
                      size="md"
                      showName
                    />
                    {forkOf && forkOfHref ? (
                      <>
                        <span className="text-[color:var(--ink-soft)] opacity-40">·</span>
                        <span className="text-sm text-[color:var(--ink-soft)]">
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
                        <span className="text-[color:var(--ink-soft)] opacity-40">·</span>
                        <span className="text-sm text-[color:var(--ink-soft)]">
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

                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge variant="compact">{PLATFORM_SKILL_LICENSE}</Badge>
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
            </div>
            <div className="flex w-full flex-col gap-3 md:w-[220px] md:shrink-0">
              {!nixPlugin && !modInfo?.isMalwareBlocked && !modInfo?.isRemoved ? (
                <a
                  href={`${convexSiteUrl}/api/v1/download?slug=${skill.slug}`}
                  className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap font-semibold text-sm min-h-[44px] rounded-[var(--radius-pill)] px-4 py-[11px] border-none bg-gradient-to-br from-[color:var(--accent)] to-[color:var(--accent-deep)] text-white transition-all duration-200 no-underline hover:-translate-y-px hover:shadow-[0_10px_20px_rgba(29,26,23,0.12)]"
                >
                  Download zip
                </a>
              ) : null}
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold text-[color:var(--ink-soft)]">
                    License
                  </span>
                  <span className="text-sm text-[color:var(--ink)]">
                    {PLATFORM_SKILL_LICENSE} · {PLATFORM_SKILL_LICENSE_SUMMARY}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isAuthenticated ? (
                  <button
                    className={`flex h-9 w-9 items-center justify-center rounded-full border transition-all duration-200 ${isStarred ? "border-amber-400/60 bg-amber-50 text-amber-500 dark:border-amber-500/40 dark:bg-amber-950/40" : "border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink-soft)] hover:text-amber-500"}`}
                    type="button"
                    onClick={onToggleStar}
                    aria-label={isStarred ? "Unstar skill" : "Star skill"}
                  >
                    <span aria-hidden="true">★</span>
                  </button>
                ) : null}
                {isAuthenticated ? (
                  <Button variant="ghost" size="sm" onClick={onOpenReport}>
                    Report
                  </Button>
                ) : null}
                {isStaff ? (
                  <Link
                    to="/management"
                    search={{ skill: skill.slug }}
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold text-xs min-h-[34px] rounded-[var(--radius-pill)] px-3 py-1.5 border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)] transition-all duration-200 no-underline"
                  >
                    Manage
                  </Link>
                ) : null}
              </div>
            </div>
          </div>

          {/* Security scan — full width below the header columns */}
          {suppressScanResults ? (
            <div className="rounded-[var(--radius-sm)] border border-amber-200/60 bg-amber-50/60 px-3 py-2 text-sm text-[color:var(--ink-soft)] dark:border-amber-500/20 dark:bg-amber-950/30">
              {overrideScanMessage}
            </div>
          ) : latestVersion?.sha256hash ||
            latestVersion?.llmAnalysis ||
            (latestVersion?.staticScan?.findings?.length ?? 0) > 0 ? (
            <div className="flex flex-col gap-2">
              <SecurityScanResults
                sha256hash={latestVersion?.sha256hash}
                vtAnalysis={latestVersion?.vtAnalysis}
                llmAnalysis={latestVersion?.llmAnalysis as LlmAnalysis | undefined}
                staticFindings={latestVersion?.staticScan?.findings}
                capabilityTags={latestVersion?.capabilityTags}
              />
              <p className="text-xs text-[color:var(--ink-soft)]">
                Like a lobster shell, security has layers — review code before you run it.
              </p>
            </div>
          ) : null}
          {hasPluginBundle ? (
            <Card className="border-dashed">
              <CardContent>
                <div className="flex flex-col gap-1">
                  <div className="font-display text-base font-bold text-[color:var(--ink)]">
                    Plugin bundle (nix)
                  </div>
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    Skill pack · CLI binary · Config
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge>SKILL.md</Badge>
                  <Badge>CLI</Badge>
                  <Badge>Config</Badge>
                </div>
                {configRequirements ? (
                  <div className="flex flex-col gap-2">
                    <div className="text-sm font-semibold text-[color:var(--ink)]">
                      Config requirements
                    </div>
                    <div className="flex flex-col gap-1">
                      {configRequirements.requiredEnv?.length ? (
                        <div className="text-sm text-[color:var(--ink-soft)]">
                          <strong>Required env</strong>
                          <span>{configRequirements.requiredEnv.join(", ")}</span>
                        </div>
                      ) : null}
                      {configRequirements.stateDirs?.length ? (
                        <div className="text-sm text-[color:var(--ink-soft)]">
                          <strong>State dirs</strong>
                          <span>{configRequirements.stateDirs.join(", ")}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {cliHelp ? (
                  <details className="flex flex-col gap-2">
                    <summary className="cursor-pointer text-sm font-semibold text-[color:var(--ink)]">
                      CLI help (from plugin)
                    </summary>
                    <pre className="mt-2 overflow-x-auto rounded-[var(--radius-sm)] bg-[color:var(--surface-muted)] p-3 font-mono text-xs">
                      {cliHelp}
                    </pre>
                  </details>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--line)] pt-4">
          {tagEntries.length === 0 ? (
            <span className="m-0 text-sm text-[color:var(--ink-soft)]">No tags yet.</span>
          ) : (
            tagEntries.map(([tag, versionId]) => (
              <Badge key={tag} className="gap-1.5">
                {tag}
                <span className="text-[0.68rem] opacity-70">
                  v{versionById.get(versionId)?.version ?? versionId}
                </span>
                {canManage && tag !== "latest" ? (
                  <button
                    type="button"
                    className="ml-0.5 cursor-pointer border-none bg-transparent p-0 text-current opacity-60 hover:opacity-100"
                    onClick={() => onTagDelete(tag)}
                    aria-label={`Delete tag ${tag}`}
                    title={`Delete tag "${tag}"`}
                  >
                    ×
                  </button>
                ) : null}
              </Badge>
            ))
          )}
        </div>

        {canManage ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onTagSubmit();
            }}
            className="flex flex-wrap items-end gap-2 border-t border-[color:var(--line)] pt-4"
          >
            <Input
              value={tagName}
              onChange={(event) => onTagNameChange(event.target.value)}
              placeholder="latest"
              className="w-auto max-w-[160px]"
            />
            <select
              className="min-h-[44px] rounded-[var(--radius-sm)] border border-[rgba(29,59,78,0.22)] bg-[rgba(255,255,255,0.94)] px-3.5 py-[13px] text-[color:var(--ink)] transition-all duration-[180ms] ease-out focus:border-[color-mix(in_srgb,var(--accent)_70%,white)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] focus:outline-none dark:border-[rgba(255,255,255,0.12)] dark:bg-[rgba(14,28,37,0.84)]"
              value={tagVersionId ?? ""}
              onChange={(event) => onTagVersionChange(event.target.value as Id<"skillVersions">)}
            >
              {tagVersions.map((version) => (
                <option key={version._id} value={version._id}>
                  v{version.version}
                </option>
              ))}
            </select>
            <Button type="submit">Update tag</Button>
          </form>
        ) : null}

        <SkillInstallCard clawdis={clawdis} osLabels={osLabels} />
      </Card>
    </>
  );
}
