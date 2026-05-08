import { lazy, Suspense } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { rehypeProxyImages } from "../lib/rehypeProxyImages";
import { resolveSkillReadmeHref } from "../lib/skillReadmeLinks";

const REHYPE_PLUGINS = [rehypeProxyImages];

const SkillFilesPanel = lazy(() =>
  import("./SkillFilesPanel").then((module) => ({ default: module.SkillFilesPanel })),
);

type SkillFile = Doc<"skillVersions">["files"][number];

export type DetailTab = "readme" | "files";

type SkillDetailTabsProps = {
  activeTab: DetailTab;
  setActiveTab: (tab: DetailTab) => void;
  readmeContent: string | null;
  readmeError: string | null;
  latestFiles: SkillFile[];
  latestVersionId: Id<"skillVersions"> | null;
  skill: Doc<"skills">;
};

export function SkillDetailTabs({
  activeTab,
  setActiveTab,
  readmeContent,
  readmeError,
  latestFiles,
  latestVersionId,
  skill,
}: SkillDetailTabsProps) {
  const selectTab = (tab: DetailTab) => {
    setActiveTab(tab);
    if (typeof window === "undefined") return;
    const hash = tab === "readme" ? "" : `#${tab}`;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
  };

  return (
    <div className="tab-card">
      <div className="tab-header">
        <button
          className={`tab-button${activeTab === "readme" ? " is-active" : ""}`}
          type="button"
          onClick={() => selectTab("readme")}
        >
          SKILL.md
        </button>
        <button
          className={`tab-button${activeTab === "files" ? " is-active" : ""}`}
          type="button"
          onClick={() => selectTab("files")}
        >
          Files
        </button>
      </div>

      {activeTab === "readme" ? (
        <div className="tab-body">
          {readmeContent ? (
            <div className="markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={REHYPE_PLUGINS}
                urlTransform={(url, key) =>
                  key === "href"
                    ? resolveSkillReadmeHref(url, skill.slug)
                    : defaultUrlTransform(url)
                }
              >
                {readmeContent}
              </ReactMarkdown>
            </div>
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

      {activeTab === "files" ? (
        <Suspense fallback={<div className="tab-body stat">Loading file viewer...</div>}>
          <SkillFilesPanel versionId={latestVersionId} latestFiles={latestFiles} />
        </Suspense>
      ) : null}
    </div>
  );
}
