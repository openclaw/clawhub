import type { ClawdisSkillMetadata } from "clawhub-schema";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { defaultUrlTransform } from "react-markdown";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { isSkillInstallTab, type DetailTab, type SkillDetailTab } from "../lib/skillDetailTabs";
import { resolveSkillReadmeHref } from "../lib/skillReadmeLinks";
import { MarkdownPreview } from "./MarkdownPreview";
import { SkillCardPreview } from "./SkillCardPreview";
import { SkillInstallPanel } from "./SkillInstallCard";
import { SkillVersionsPanel } from "./SkillVersionsPanel";
import { Skeleton } from "./ui/skeleton";

const SkillDiffCard = lazy(() =>
  import("./SkillDiffCard").then((module) => ({ default: module.SkillDiffCard })),
);

const SkillFilesPanel = lazy(() =>
  import("./SkillFilesPanel").then((module) => ({ default: module.SkillFilesPanel })),
);

const README_COLLAPSED_LINE_COUNT = 50;

function SkillTabSkeleton() {
  return (
    <div className="skill-tab-skeleton" role="status" aria-label="Loading tab content">
      <Skeleton className="skill-tab-skeleton-title" />
      <div className="skill-tab-skeleton-copy" aria-hidden="true">
        <Skeleton />
        <Skeleton />
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    </div>
  );
}

type SkillFile = Doc<"skillVersions">["files"][number];

type SkillDetailTabsProps = {
  activeTab: DetailTab;
  setActiveTab: (tab: DetailTab) => void;
  onCompareIntent: () => void;
  readmeContent: string | null;
  readmeError: string | null;
  isPendingPublication?: boolean;
  skillCardContent: string | null;
  skillCardError: string | null;
  tabs: SkillDetailTab[];
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
  clawdis: ClawdisSkillMetadata | undefined;
  osLabels: string[];
  readmeHrefResolver?: (href: string) => string;
  evaluationContent?: ReactNode;
};

export function SkillDetailTabs({
  activeTab,
  setActiveTab,
  onCompareIntent,
  readmeContent,
  readmeError,
  isPendingPublication = false,
  skillCardContent,
  skillCardError,
  tabs,
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
  clawdis,
  osLabels,
  readmeHrefResolver,
  evaluationContent,
}: SkillDetailTabsProps) {
  const resolveReadmeHref =
    readmeHrefResolver ?? ((href: string) => resolveSkillReadmeHref(href, skill.slug, ownerHandle));
  const activeInstallTab =
    isSkillInstallTab(activeTab) && tabs.some((tab) => tab.id === activeTab) ? activeTab : null;
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

  const prefetchCompare = () => {
    onCompareIntent();
    void import("./SkillDiffCard");
  };

  return (
    <div className="tab-card detail-mobile-tabs skill-detail-tabs-card">
      <div className="tab-header" role="tablist" aria-label="Skill detail tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`skill-tab-${tab.id}`}
            className={`tab-button${activeTab === tab.id ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`skill-tabpanel-${tab.id}`}
            onClick={() => selectTab(tab.id)}
            onMouseEnter={tab.id === "compare" ? prefetchCompare : undefined}
            onFocus={tab.id === "compare" ? prefetchCompare : undefined}
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
                data-analytics-public-detail=""
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
          ) : isPendingPublication ? (
            <div className="empty-state px-[var(--space-4)] py-[var(--space-6)]">
              <p className="empty-state-title">Files pending security checks</p>
              <p className="empty-state-body">
                The SKILL.md preview will be available when publication completes.
              </p>
            </div>
          ) : readmeError ? (
            <div className="empty-state px-[var(--space-4)] py-[var(--space-6)]">
              <p className="empty-state-title">No README available</p>
              <p className="empty-state-body">This skill doesn't have a SKILL.md file yet.</p>
            </div>
          ) : (
            <SkillTabSkeleton />
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
          {skillCardContent ? (
            <>
              <details className="skill-card-info-callout" open>
                <summary>About Skill Cards</summary>
                <p>
                  Skill Cards follow{" "}
                  <a
                    href="https://docs.nvidia.com/skills/skill-cards"
                    target="_blank"
                    rel="noreferrer"
                  >
                    NVIDIA&apos;s trust-card pattern for agent skills
                  </a>
                  , giving a compact release record of what a skill does, who published it, and what
                  risks or limits to review before use.
                </p>
              </details>
              <SkillCardPreview
                content={skillCardContent}
                urlTransform={(url, key) =>
                  key === "href" ? resolveReadmeHref(url) : defaultUrlTransform(url)
                }
              />
            </>
          ) : skillCardError ? (
            <div className="empty-state px-[var(--space-4)] py-[var(--space-6)]">
              <p className="empty-state-title">No Skill Card available</p>
              <p className="empty-state-body">The generated skill-card.md file is not available.</p>
            </div>
          ) : (
            <SkillTabSkeleton />
          )}
        </div>
      ) : null}

      {evaluationContent && activeTab === "evaluation" ? (
        <div
          className="tab-body skill-evaluation-tab-body"
          role="tabpanel"
          id="skill-tabpanel-evaluation"
          aria-labelledby="skill-tab-evaluation"
        >
          {evaluationContent}
        </div>
      ) : null}

      {showArchiveTabs && activeTab === "files" ? (
        <div role="tabpanel" id="skill-tabpanel-files" aria-labelledby="skill-tab-files">
          <Suspense
            fallback={
              <div className="tab-body">
                <SkillTabSkeleton />
              </div>
            }
          >
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
            <SkillTabSkeleton />
          ) : (
            <Suspense fallback={<SkillTabSkeleton />}>
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
          />
        </div>
      ) : null}

      {activeInstallTab ? (
        <div
          className="tab-body skill-install-tabs"
          role="tabpanel"
          id={`skill-tabpanel-${activeInstallTab}`}
          aria-labelledby={`skill-tab-${activeInstallTab}`}
        >
          <SkillInstallPanel tab={activeInstallTab} clawdis={clawdis} osLabels={osLabels} />
        </div>
      ) : null}
    </div>
  );
}
