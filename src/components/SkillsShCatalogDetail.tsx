import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  GitBranch,
  ShieldAlert,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { getSkillCategoriesForSkill } from "../lib/categories";
import { formatCompactStat } from "../lib/numberFormat";
import {
  isSkillsShCatalogInstallable,
  SKILLS_SH_TRUST_LABEL,
  skillsShRepositoryLabel,
  type SkillsShCatalogDetail,
  type SkillsShUpstreamCheck,
} from "../lib/skillsShCatalog";
import { timeAgo } from "../lib/timeAgo";
import { truncateText } from "../lib/truncateText";
import { MarkdownPreview } from "./MarkdownPreview";
import { SidebarMetadata } from "./SidebarMetadata";
import { SkillDetailPageView, type SkillDetailViewSkill } from "./SkillDetailPageView";
import { SkillCommandLineCard } from "./SkillInstallSurface";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const CHECK_PRESENTATION = {
  passed: { Icon: CheckCircle2, className: "text-status-success-fg" },
  warning: { Icon: TriangleAlert, className: "text-status-warning-fg" },
  failed: { Icon: XCircle, className: "text-status-error-fg" },
  unavailable: { Icon: CircleHelp, className: "text-ink-soft" },
} as const;

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

export function SkillsShCatalogDetailPage({ entry }: { entry: SkillsShCatalogDetail }) {
  const installable = isSkillsShCatalogInstallable(entry);
  const repositoryLabel = skillsShRepositoryLabel(entry);
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
      // The ClawHub CLI resolves skills-sh: references directly; this is not a claimed registry slug.
      secondaryInstall={{
        label: "ClawHub",
        command: `clawhub install ${entry.reference}`,
        copyAriaLabel: "Copy ClawHub install command",
      }}
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
      titleAccessory={
        <Badge variant="compact" className="skills-sh-detail-source-badge">
          skills.sh
        </Badge>
      }
      breadcrumbOwnerHref={null}
      breadcrumbOwnerLabel={entry.owner ?? "skills.sh"}
      breadcrumbSkillHref={entry.route}
      creatorContent={
        <a
          className="skills-sh-detail-source-owner"
          href={entry.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          @{entry.owner ?? repositoryLabel} on skills.sh
          <ExternalLink aria-hidden="true" size={13} />
        </a>
      }
      heroNotice={
        <Alert variant="warn" className="skills-sh-detail-trust-alert">
          <ShieldAlert aria-hidden="true" size={17} />
          <AlertDescription>
            This is a stored upstream skills.sh listing. ClawHub has not scanned or accepted this
            source.
          </AlertDescription>
        </Alert>
      }
      installContent={installContent}
      renderSidebarContent={() => (
        <SkillsShSidebar entry={entry} repositoryLabel={repositoryLabel} />
      )}
    >
      <SkillsShContentTabs entry={entry} />
    </SkillDetailPageView>
  );
}

function SkillsShSidebar({
  entry,
  repositoryLabel,
}: {
  entry: SkillsShCatalogDetail;
  repositoryLabel: string;
}) {
  return (
    <div className="skill-hero-sidebar-stack">
      <SidebarMetadata
        ariaLabel="skills.sh metadata"
        density="compact"
        blocks={[
          {
            label: "Upstream installs",
            value: (
              <span title={`${entry.upstreamInstalls.toLocaleString()} installs`}>
                {formatCompactStat(entry.upstreamInstalls)}
              </span>
            ),
            large: true,
          },
          {
            label: "Source",
            value: (
              <a href={entry.sourceUrl} target="_blank" rel="noreferrer">
                {repositoryLabel}
              </a>
            ),
          },
          {
            grid: [
              { label: "Observed", value: timeAgo(entry.lastObservedAt) },
              { label: "Trust", value: SKILLS_SH_TRUST_LABEL },
            ],
          },
          ...(entry.githubPath ? [{ label: "Path", value: <code>{entry.githubPath}</code> }] : []),
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

      <section className="skills-sh-upstream-checks" aria-label="Upstream checks">
        <div className="skills-sh-upstream-checks-heading">
          <h2>Upstream checks</h2>
          <p>Separate from ClawHub scanning.</p>
        </div>
        <div className="skills-sh-upstream-checks-list">
          {entry.upstreamChecks.map((check) => (
            <UpstreamCheck key={check.scanner} check={check} />
          ))}
        </div>
      </section>

      <div className="skills-sh-detail-links">
        <Button asChild variant="outline" size="sm">
          <a href={entry.sourceUrl} target="_blank" rel="noreferrer">
            View on skills.sh <ExternalLink aria-hidden="true" size={14} />
          </a>
        </Button>
        {entry.canonicalRepoUrl ? (
          <Button asChild variant="outline" size="sm">
            <a href={entry.canonicalRepoUrl} target="_blank" rel="noreferrer">
              Repository <ExternalLink aria-hidden="true" size={14} />
            </a>
          </Button>
        ) : null}
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
              <GitBranch size={15} aria-hidden="true" /> Claim
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
            <div className="skills-sh-content-meta">
              <code>{entry.content.path}</code>
              {entry.content.truncated ? (
                <span>Content is truncated to the stored 64 KiB snapshot.</span>
              ) : null}
            </div>
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
  const presentation = CHECK_PRESENTATION[check.status];
  const Icon = presentation.Icon;
  return (
    <div className="skills-sh-upstream-check">
      <div className="skills-sh-upstream-check-title">
        <Icon aria-hidden="true" size={15} className={presentation.className} />
        <span>{check.scanner}</span>
      </div>
      <p className={presentation.className}>{check.sourceStatus}</p>
      {check.checkedAt ? <p>Checked {timeAgo(check.checkedAt)}</p> : null}
      {check.url ? (
        <a href={check.url} target="_blank" rel="noreferrer">
          View result <ExternalLink aria-hidden="true" size={12} />
        </a>
      ) : null}
    </div>
  );
}
