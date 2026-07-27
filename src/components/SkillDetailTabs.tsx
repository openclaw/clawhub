import type { ClawdisSkillMetadata } from "clawhub-schema";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { defaultUrlTransform } from "react-markdown";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { resolveSkillReadmeHref } from "../lib/skillReadmeLinks";
import { MarkdownPreview } from "./MarkdownPreview";
import { SkillCardPreview } from "./SkillCardPreview";
import { buildSkillInstallTabs, type SkillInstallTabId } from "./SkillInstallCard";
import { SkillVersionsPanel } from "./SkillVersionsPanel";
import { Skeleton } from "./ui/skeleton";

const SkillDiffCard = lazy(() =>
  import("./SkillDiffCard").then((module) => ({ default: module.SkillDiffCard })),
);

const SkillFilesPanel = lazy(() =>
  import("./SkillFilesPanel").then((module) => ({ default: module.SkillFilesPanel })),
);

const README_COLLAPSED_LINE_COUNT = 50;

function SkillDiffSkeleton() {
  return (
    <div className="skill-diff-skeleton" role="status" aria-label="Loading diff viewer">
      <div className="diff-skeleton-toolbar">
        <div className="diff-skeleton-version-row">
          <div className="diff-skeleton-field">
            <Skeleton className="diff-skeleton-label" />
            <Skeleton className="diff-skeleton-control" />
          </div>
          <Skeleton className="diff-skeleton-swap" />
          <div className="diff-skeleton-field">
            <Skeleton className="diff-skeleton-label" />
            <Skeleton className="diff-skeleton-control" />
          </div>
        </div>
        <div className="diff-skeleton-field diff-skeleton-view">
          <Skeleton className="diff-skeleton-label diff-skeleton-label-short" />
          <Skeleton className="diff-skeleton-toggle" />
        </div>
      </div>
      <div className="diff-skeleton-file-bar">
        <Skeleton className="diff-skeleton-arrow" />
        <Skeleton className="diff-skeleton-file-select" />
        <Skeleton className="diff-skeleton-arrow" />
        <Skeleton className="diff-skeleton-badge" />
        <Skeleton className="diff-skeleton-count" />
      </div>
      <div className="diff-skeleton-editor">
        <div className="diff-skeleton-gutter" aria-hidden="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
        <div className="diff-skeleton-code" aria-hidden="true">
          <Skeleton className="w-[18%]" />
          <Skeleton className="w-[58%]" />
          <Skeleton className="w-[82%]" />
          <Skeleton className="w-[72%]" />
          <Skeleton className="mt-4 w-[34%]" />
          <Skeleton className="w-[66%]" />
          <Skeleton className="w-[48%]" />
        </div>
      </div>
    </div>
  );
}

type SkillFile = Doc<"skillVersions">["files"][number];

export type DetailTab =
  | "readme"
  | "skill-card"
  | "files"
  | "compare"
  | "versions"
  | SkillInstallTabId;

type SkillDetailTabsProps = {
  activeTab: DetailTab;
  setActiveTab: (tab: DetailTab) => void;
  onCompareIntent: () => void;
  readmeContent: string | null;
  readmeError: string | null;
  skillCardContent: string | null;
  skillCardError: string | null;
  hasSkillCard: boolean;
  latestFiles: SkillFile[];
  latestVersionId: Id<"skillVersions"> | null;
  latestVersion?: string | null;
  canDeleteVersions?: boolean;
  skill: Doc<"skills">;
  ownerHandle?: string | null;
  diffVersions: Doc<"skillVersions">[] | undefined;
  versions: Doc<"skillVersions">[] | undefined;
  nixPlugin: boolean;
  showArchiveTabs?: boolean;
  suppressVersionScanResults: boolean;
  scanResultsSuppressedMessage: string | null;
  clawdis: ClawdisSkillMetadata | undefined;
  osLabels: string[];
  readmeHrefResolver?: (href: string) => string;
};

export function SkillDetailTabs({
  activeTab,
  setActiveTab,
  onCompareIntent,
  readmeContent,
  readmeError,
  skillCardContent,
  skillCardError,
  hasSkillCard,
  latestFiles,
  latestVersionId,
  latestVersion,
  canDeleteVersions = false,
  skill,
  ownerHandle,
  diffVersions,
  versions,
  nixPlugin,
  showArchiveTabs = true,
  suppressVersionScanResults,
  scanResultsSuppressedMessage,
  clawdis,
  osLabels,
  readmeHrefResolver,
}: SkillDetailTabsProps) {
  const resolveReadmeHref =
    readmeHrefResolver ?? ((href: string) => resolveSkillReadmeHref(href, skill.slug, ownerHandle));
  const installTabs = buildSkillInstallTabs({ clawdis, osLabels });
  const activeInstallTab = installTabs.find((tab) => tab.id === activeTab);
  const compareEnabled = showArchiveTabs && (versions?.length ?? 0) > 1;
  const [isReadmeExpanded, setIsReadmeExpanded] = useState(false);
  const readmeLineCount = useMemo(
    () => readmeContent?.split(/\r\n|\n|\r/).length ?? 0,
    [readmeContent],
  );
  const isReadmeLong = readmeLineCount > README_COLLAPSED_LINE_COUNT;

  useEffect(() => {
    setIsReadmeExpanded(false);
  }, [readmeContent]);

  const selectTab = (tab: DetailTab) => {
    const scrollPosition =
      typeof window === "undefined" ? null : { left: window.scrollX, top: window.scrollY };
    setActiveTab(tab);
    if (typeof window === "undefined") return;
    const hash = tab === "readme" ? "" : tab === "compare" ? "#diff" : `#${tab}`;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
    window.requestAnimationFrame(() => {
      if (!scrollPosition) return;
      window.scrollTo(scrollPosition.left, scrollPosition.top);
    });
  };

  return (
    <div className="tab-card detail-mobile-tabs skill-detail-tabs-card">
      <div className="tab-header" role="tablist" aria-label="Skill detail tabs">
        <button
          id="skill-tab-readme"
          className={`tab-button${activeTab === "readme" ? " is-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={activeTab === "readme"}
          aria-controls="skill-tabpanel-readme"
          onClick={() => selectTab("readme")}
        >
          SKILL.md
        </button>
        {hasSkillCard ? (
          <button
            id="skill-tab-skill-card"
            className={`tab-button${activeTab === "skill-card" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "skill-card"}
            aria-controls="skill-tabpanel-skill-card"
            onClick={() => selectTab("skill-card")}
          >
            Skill Card
          </button>
        ) : null}
        {showArchiveTabs ? (
          <button
            id="skill-tab-files"
            className={`tab-button${activeTab === "files" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "files"}
            aria-controls="skill-tabpanel-files"
            onClick={() => selectTab("files")}
          >
            Files
          </button>
        ) : null}
        {compareEnabled ? (
          <button
            id="skill-tab-compare"
            className={`tab-button${activeTab === "compare" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "compare"}
            aria-controls="skill-tabpanel-compare"
            onClick={() => selectTab("compare")}
            onMouseEnter={() => {
              onCompareIntent();
              void import("./SkillDiffCard");
            }}
            onFocus={() => {
              onCompareIntent();
              void import("./SkillDiffCard");
            }}
          >
            Diff
          </button>
        ) : null}
        {showArchiveTabs ? (
          <button
            id="skill-tab-versions"
            className={`tab-button${activeTab === "versions" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "versions"}
            aria-controls="skill-tabpanel-versions"
            onClick={() => selectTab("versions")}
          >
            Versions
          </button>
        ) : null}
        {installTabs.map((tab) => (
          <button
            key={tab.id}
            id={`skill-tab-${tab.id}`}
            className={`tab-button${activeTab === tab.id ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`skill-tabpanel-${tab.id}`}
            onClick={() => selectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "readme" ? (
        <div
          className="tab-body skill-readme-body"
          role="tabpanel"
          id="skill-tabpanel-readme"
          aria-labelledby="skill-tab-readme"
        >
          {readmeContent ? (
            <>
              <div
                className={`skill-readme-preview${
                  isReadmeLong && !isReadmeExpanded ? " is-collapsed" : ""
                }`}
              >
                <MarkdownPreview
                  highlight={false}
                  urlTransform={(url, key) =>
                    key === "href" ? resolveReadmeHref(url) : defaultUrlTransform(url)
                  }
                >
                  {readmeContent}
                </MarkdownPreview>
              </div>
              {isReadmeLong ? (
                <button
                  type="button"
                  className="skill-readme-toggle"
                  aria-expanded={isReadmeExpanded}
                  onClick={() => setIsReadmeExpanded((expanded) => !expanded)}
                >
                  {isReadmeExpanded ? "Show less" : "Read more"}
                </button>
              ) : null}
            </>
          ) : readmeError ? (
            <div className="empty-state px-[var(--space-4)] py-[var(--space-6)]">
              <p className="empty-state-title">No README available</p>
              <p className="empty-state-body">This skill doesn't have a SKILL.md file yet.</p>
            </div>
          ) : (
            <div className="stat p-4">Loading README...</div>
          )}
        </div>
      ) : null}

      {activeTab === "skill-card" ? (
        <div
          className="tab-body skill-card-tab-body"
          role="tabpanel"
          id="skill-tabpanel-skill-card"
          aria-labelledby="skill-tab-skill-card"
        >
          <details className="skill-card-info-callout" open>
            <summary>About Skill Cards</summary>
            <p>
              Skill Cards follow{" "}
              <a href="https://docs.nvidia.com/skills/skill-cards" target="_blank" rel="noreferrer">
                NVIDIA&apos;s trust-card pattern for agent skills
              </a>
              , giving a compact release record of what a skill does, who published it, and what
              risks or limits to review before use.
            </p>
          </details>
          {skillCardContent ? (
            <SkillCardPreview
              content={skillCardContent}
              urlTransform={(url, key) =>
                key === "href" ? resolveReadmeHref(url) : defaultUrlTransform(url)
              }
            />
          ) : skillCardError ? (
            <div className="empty-state px-[var(--space-4)] py-[var(--space-6)]">
              <p className="empty-state-title">No Skill Card available</p>
              <p className="empty-state-body">The generated skill-card.md file is not available.</p>
            </div>
          ) : (
            <div className="stat p-4">Loading Skill Card...</div>
          )}
        </div>
      ) : null}

      {showArchiveTabs && activeTab === "files" ? (
        <div role="tabpanel" id="skill-tabpanel-files" aria-labelledby="skill-tab-files">
          <Suspense fallback={<div className="tab-body stat">Loading file viewer...</div>}>
            <SkillFilesPanel
              versionId={latestVersionId}
              version={latestVersion ?? null}
              latestFiles={latestFiles}
              skillSlug={skill.slug}
              ownerHandle={ownerHandle}
            />
          </Suspense>
        </div>
      ) : null}

      {showArchiveTabs && activeTab === "compare" ? (
        <div
          className="tab-body skill-diff-tab-body"
          role="tabpanel"
          id="skill-tabpanel-compare"
          aria-labelledby="skill-tab-compare"
        >
          {diffVersions === undefined ? (
            <SkillDiffSkeleton />
          ) : (
            <Suspense fallback={<SkillDiffSkeleton />}>
              <SkillDiffCard skill={skill} versions={diffVersions} variant="embedded" />
            </Suspense>
          )}
        </div>
      ) : null}

      {showArchiveTabs && activeTab === "versions" ? (
        <div role="tabpanel" id="skill-tabpanel-versions" aria-labelledby="skill-tab-versions">
          <SkillVersionsPanel
            skillId={skill._id}
            versions={versions}
            latestVersionId={latestVersionId}
            latestTaggedVersionId={skill.tags.latest ?? null}
            canDeleteVersions={canDeleteVersions}
            nixPlugin={nixPlugin}
            skillSlug={skill.slug}
            ownerHandle={ownerHandle}
            suppressScanResults={suppressVersionScanResults}
            suppressedMessage={scanResultsSuppressedMessage}
          />
        </div>
      ) : null}

      {activeInstallTab ? (
        <div
          className="tab-body skill-install-tabs"
          role="tabpanel"
          id={`skill-tabpanel-${activeInstallTab.id}`}
          aria-labelledby={`skill-tab-${activeInstallTab.id}`}
        >
          {activeInstallTab.panel}
        </div>
      ) : null}
    </div>
  );
}
