import { Link } from "@tanstack/react-router";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import { getSkillCategoriesForSkill } from "../lib/categories";
import { formatCompactStat } from "../lib/numberFormat";
import {
  isSkillsShCatalogInstallable,
  type SkillsShCatalogDetail,
  type SkillsShUpstreamCheck,
} from "../lib/skillsShCatalog";
import { truncateText } from "../lib/truncateText";
import { MarkdownPreview } from "./MarkdownPreview";
import { SidebarMetadata } from "./SidebarMetadata";
import { SkillDetailPageView, type SkillDetailViewSkill } from "./SkillDetailPageView";
import { SkillCommandLineCard } from "./SkillInstallSurface";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { UserBadge } from "./UserBadge";

const CHECK_PRESENTATION = {
  passed: "success",
  warning: "warning",
  failed: "destructive",
  unavailable: "compact",
} as const;

function GitHubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18.92-.26 1.9-.38 2.88-.39.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.42-2.69 5.39-5.25 5.67.42.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function skillsShSummary(summary: string | undefined) {
  if (!summary) return "Agent-ready skill pack from skills.sh.";
  const plain = summary
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/^[#>]+\s*/gmu, "")
    .replace(/[*_`~]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return truncateText(plain, 280);
}

function pinnedGitHubSourceUrl(entry: SkillsShCatalogDetail) {
  const repositoryUrl = `https://github.com/${entry.canonicalGitHubRepo}`;
  if (!entry.githubCommit) return entry.canonicalRepoUrl ?? repositoryUrl;
  if (!entry.githubPath) return `${repositoryUrl}/tree/${entry.githubCommit}`;
  const encodedPath = entry.githubPath.split("/").map(encodeURIComponent).join("/");
  return `${repositoryUrl}/tree/${entry.githubCommit}/${encodedPath}`;
}

export function SkillsShCatalogDetailPage({ entry }: { entry: SkillsShCatalogDetail }) {
  const installable = isSkillsShCatalogInstallable(entry);
  const githubOwner = entry.canonicalGitHubRepo.split("/")[0] ?? entry.canonicalGitHubRepo;
  const skill: SkillDetailViewSkill = {
    slug: entry.slug,
    displayName: entry.displayName,
    summary: skillsShSummary(entry.summary),
    icon: null,
    ...(installable
      ? { installKind: "github" as const, githubSourceRepo: entry.canonicalGitHubRepo }
      : {}),
    categories: entry.categories,
    inferredCategories: [],
    topics: entry.topics,
    badges: {},
    stats: {
      downloads: entry.upstreamInstalls,
      stars: 0,
      installs: entry.upstreamInstalls,
      versions: 0,
      comments: 0,
    },
    updatedAt: entry.lastObservedAt,
  };

  const installContent = installable ? (
    <SkillCommandLineCard
      slug={entry.slug}
      displayName={entry.displayName}
      ownerHandle={entry.owner ?? null}
      ownerId={null}
      installTarget={entry.reference}
      skillPageUrl={null}
    />
  ) : (
    <Alert variant="warn">
      <ShieldAlert aria-hidden="true" size={17} />
      <AlertDescription>
        This snapshot does not include a commit-pinned GitHub folder, so it cannot be installed yet.
      </AlertDescription>
    </Alert>
  );

  return (
    <SkillDetailPageView
      pageClassName="skills-sh-detail-page"
      skill={skill}
      owner={null}
      ownerHandle={entry.owner ?? null}
      latestVersion={null}
      modInfo={null}
      canManage={false}
      isAuthenticated={false}
      isStaff={false}
      isStarred={false}
      onToggleStar={() => undefined}
      onOpenReport={() => undefined}
      onRequireSignIn={() => undefined}
      forkOf={null}
      forkOfLabel="fork of"
      forkOfHref={null}
      forkOfOwnerHandle={null}
      canonical={null}
      canonicalHref={null}
      canonicalOwnerHandle={null}
      staffVisibilityTag={null}
      isAutoHidden={false}
      isRemoved={false}
      nixPlugin={undefined}
      hasPluginBundle={false}
      configRequirements={undefined}
      cliHelp={undefined}
      clawdis={undefined}
      categories={getSkillCategoriesForSkill(skill)}
      showArchiveMetadata={false}
      showBookmarkAction={false}
      showReportAction={false}
      taxonomyPrefix={
        <span className="skills-sh-sync-source-label">
          Synced from{" "}
          <a
            className="skills-sh-sync-source"
            href={entry.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            skills.sh
          </a>
        </span>
      }
      breadcrumbOwnerHref={null}
      breadcrumbOwnerLabel={entry.owner ?? "skills.sh"}
      breadcrumbSkillHref={entry.route}
      creatorContent={
        <UserBadge
          user={{
            handle: githubOwner,
            displayName: githubOwner,
            image: `https://github.com/${githubOwner}.png?size=96`,
          }}
          fallbackHandle={githubOwner}
          prefix=""
          size="md"
          showName
          showHandle={false}
          showMutedHandle
          stackMutedHandleBelowName
          disableTooltip
          profileHref={`https://github.com/${githubOwner}`}
        />
      }
      installContent={installContent}
      renderSidebarContent={() => <SkillsShSidebar entry={entry} />}
    >
      <SkillsShContentTabs entry={entry} />
    </SkillDetailPageView>
  );
}

function SkillsShSidebar({ entry }: { entry: SkillsShCatalogDetail }) {
  return (
    <div className="skill-hero-sidebar-stack">
      <SidebarMetadata
        ariaLabel="skills.sh metadata"
        density="compact"
        blocks={[
          {
            label: "Downloads",
            value: (
              <span title={`${entry.upstreamInstalls.toLocaleString()} downloads`}>
                {formatCompactStat(entry.upstreamInstalls)}
              </span>
            ),
            large: true,
          },
          {
            label: "Repository",
            value: (
              <a
                href={pinnedGitHubSourceUrl(entry)}
                target="_blank"
                rel="noreferrer"
                className="plugin-external-link"
              >
                <GitHubIcon />
                {entry.canonicalGitHubRepo}
              </a>
            ),
          },
          ...(entry.githubCommit
            ? [
                {
                  label: "Commit",
                  value: <code>{entry.githubCommit.slice(0, 12)}</code>,
                },
              ]
            : []),
        ]}
      />

      <section className="skills-sh-security-audits" aria-label="Security Audits">
        <h2 className="sidebar-metadata-label">Security Audits</h2>
        <div className="skills-sh-security-audit-list">
          {entry.upstreamChecks.map((check) => (
            <UpstreamCheck key={check.scanner} check={check} />
          ))}
        </div>
      </section>

      <div className="skills-sh-detail-links">
        {entry.githubPath && entry.githubCommit && entry.githubContentHash ? (
          <Button asChild variant="outline" size="sm">
            <Link
              to="/settings"
              search={{
                view: "githubSources",
                ownerHandle: entry.canonicalGitHubRepo.split("/")[0],
                repo: entry.canonicalGitHubRepo,
                sourceRepo: entry.canonicalGitHubRepo,
                sourceExternalId: entry.externalId,
                sourcePath: entry.githubPath,
                sourceCommit: entry.githubCommit,
                sourceContentHash: entry.githubContentHash,
              }}
            >
              <BadgeCheck size={15} aria-hidden="true" /> Claim this skill
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SkillsShContentTabs({ entry }: { entry: SkillsShCatalogDetail }) {
  return (
    <div className="tab-card detail-mobile-tabs skill-detail-tabs-card">
      <div className="tab-header" role="tablist" aria-label="Skill detail tabs">
        <button
          id="skill-tab-readme"
          className="tab-button is-active"
          type="button"
          role="tab"
          aria-selected="true"
          aria-controls="skill-tabpanel-readme"
        >
          {entry.content?.kind === "readme" ? "README" : "SKILL.md"}
        </button>
      </div>
      <div
        className="tab-body skill-readme-body"
        role="tabpanel"
        id="skill-tabpanel-readme"
        aria-labelledby="skill-tab-readme"
      >
        {entry.content ? (
          <>
            {entry.content.truncated ? (
              <p className="skills-sh-content-note">
                Content is truncated to the stored 64 KiB snapshot.
              </p>
            ) : null}
            <div className="skill-readme-preview">
              <MarkdownPreview highlight={false}>{entry.content.markdown}</MarkdownPreview>
            </div>
          </>
        ) : (
          <div className="empty-state px-[var(--space-4)] py-[var(--space-6)]">
            <p className="empty-state-title">No stored content available</p>
            <p className="empty-state-body">This skills.sh listing has no stored Markdown.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function UpstreamCheck({ check }: { check: SkillsShUpstreamCheck }) {
  const content = (
    <>
      <span>{check.scanner}</span>
      <Badge
        variant={CHECK_PRESENTATION[check.status]}
        size="sm"
        className="skills-sh-security-audit-verdict"
      >
        {check.sourceStatus}
      </Badge>
    </>
  );
  return check.url ? (
    <a className="skills-sh-security-audit-row" href={check.url} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : (
    <div className="skills-sh-security-audit-row">{content}</div>
  );
}
