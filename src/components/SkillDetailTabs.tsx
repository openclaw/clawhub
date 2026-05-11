import type { ClawdisSkillMetadata } from "clawhub-schema";
import { lazy, Suspense } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { rehypeProxyImages } from "../lib/rehypeProxyImages";
import { resolveSkillReadmeHref } from "../lib/skillReadmeLinks";
import { buildSkillInstallTabs, type SkillInstallTabId } from "./SkillInstallCard";
import { SkillVersionsPanel } from "./SkillVersionsPanel";

const REHYPE_PLUGINS = [rehypeProxyImages];

const SkillDiffCard = lazy(() =>
  import("./SkillDiffCard").then((module) => ({ default: module.SkillDiffCard })),
);

const SkillFilesPanel = lazy(() =>
  import("./SkillFilesPanel").then((module) => ({ default: module.SkillFilesPanel })),
);

type SkillFile = Doc<"skillVersions">["files"][number];

export type DetailTab = "readme" | "files" | "compare" | "versions" | SkillInstallTabId;

type SkillDetailTabsProps = {
  activeTab: DetailTab;
  setActiveTab: (tab: DetailTab) => void;
  onCompareIntent: () => void;
  readmeContent: string | null;
  readmeError: string | null;
  latestFiles: SkillFile[];
  latestVersionId: Id<"skillVersions"> | null;
  skill: Doc<"skills">;
  diffVersions: Doc<"skillVersions">[] | undefined;
  versions: Doc<"skillVersions">[] | undefined;
  nixPlugin: boolean;
  suppressVersionScanResults: boolean;
  scanResultsSuppressedMessage: string | null;
  clawdis: ClawdisSkillMetadata | undefined;
  osLabels: string[];
};

export function SkillDetailTabs({
  activeTab,
  setActiveTab,
  onCompareIntent,
  readmeContent,
  readmeError,
  latestFiles,
  latestVersionId,
  skill,
  diffVersions,
  versions,
  nixPlugin,
  suppressVersionScanResults,
  scanResultsSuppressedMessage,
  clawdis,
  osLabels,
}: SkillDetailTabsProps) {
  const installTabs = buildSkillInstallTabs({ clawdis, osLabels });
  const activeInstallTab = installTabs.find((tab) => tab.id === activeTab);
  const compareEnabled = (versions?.length ?? 0) > 1;
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
      <div className="tab-header" role="tablist" aria-label="Skill detail tabs">
        <button
          className={`tab-button${activeTab === "readme" ? " is-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={activeTab === "readme"}
          onClick={() => selectTab("readme")}
        >
          SKILL.md
        </button>
        <button
          className={`tab-button${activeTab === "files" ? " is-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={activeTab === "files"}
          onClick={() => selectTab("files")}
        >
          Files
        </button>
        {compareEnabled ? (
          <button
            className={`tab-button${activeTab === "compare" ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === "compare"}
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
            Compare
          </button>
        ) : null}
        <button
          className={`tab-button${activeTab === "versions" ? " is-active" : ""}`}
          type="button"
          role="tab"
          aria-selected={activeTab === "versions"}
          onClick={() => selectTab("versions")}
        >
          Versions
        </button>
        {installTabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab-button${activeTab === tab.id ? " is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => selectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
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

      {activeTab === "compare" ? (
        <div className="tab-body">
          <Suspense fallback={<div className="stat">Loading diff viewer...</div>}>
            <SkillDiffCard skill={skill} versions={diffVersions ?? []} variant="embedded" />
          </Suspense>
        </div>
      ) : null}

      {activeTab === "versions" ? (
        <SkillVersionsPanel
          versions={versions}
          nixPlugin={nixPlugin}
          skillSlug={skill.slug}
          suppressScanResults={suppressVersionScanResults}
          suppressedMessage={scanResultsSuppressedMessage}
        />
      ) : null}

      {activeInstallTab ? (
        <div className="tab-body skill-install-tabs">{activeInstallTab.panel}</div>
      ) : null}
    </div>
  );
}
