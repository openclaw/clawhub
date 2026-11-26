import type { ClawdisSkillMetadata } from "clawhub-schema";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { defaultUrlTransform } from "react-markdown";
import type { Doc } from "../../convex/_generated/dataModel";
import { isSkillInstallTab, type DetailTab, type SkillDetailTab } from "../lib/skillDetailTabs";
import { resolveSkillReadmeHref } from "../lib/skillReadmeLinks";
import { MarkdownPreview } from "./MarkdownPreview";
import { SkillInstallPanel } from "./SkillInstallCard";
import { Skeleton } from "./ui/skeleton";

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

type SkillDetailTabsProps = {
  activeTab: DetailTab;
  setActiveTab: (tab: DetailTab) => void;
  readmeContent: string | null;
  readmeError: string | null;
  isPendingPublication?: boolean;
  tabs: SkillDetailTab[];
  skill: Pick<Doc<"skills">, "slug">;
  ownerHandle?: string | null;
  clawdis: ClawdisSkillMetadata | undefined;
  osLabels: string[];
  readmeHrefResolver?: (href: string) => string;
  evaluationContent?: ReactNode;
};

export function SkillDetailTabs({
  activeTab,
  setActiveTab,
  readmeContent,
  readmeError,
  isPendingPublication = false,
  tabs,
  skill,
  ownerHandle,
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
    const hash = tab === "readme" ? "" : `#${tab}`;
    window.history.replaceState(
      window.history.state,
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
