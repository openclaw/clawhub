import type { TemplateManifest } from "clawhub-schema";
import { TEMPLATE_CATEGORY_DEFINITIONS } from "clawhub-schema/catalogMetadata";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fetchPackageFile, type PackageDetailResponse } from "../lib/packageApi";
import { parseTemplateDocument } from "../lib/templateDetail";
import { isTemplateReadyToAdd } from "../lib/templateRoutes";
import { auditVerdictMeterLevel, DetailSecuritySummaryLabel } from "./DetailSecuritySummary";
import { MarkdownPreview } from "./MarkdownPreview";
import { aggregateAuditVerdict } from "./securityAuditModel";
import { SidebarMetadata } from "./SidebarMetadata";
import { formatOpenClawPrompt } from "./skillDetailUtils";
import { InstallCommandCard } from "./SkillInstallSurface";
import type { LlmAnalysis } from "./SkillSecurityScanResults";
import { UserBadge } from "./UserBadge";
import "./template-detail.css";

const tabs = ["CLAW.md", "Skills", "Automations", "Plugins", "Workspace files"] as const;
type TemplateTab = (typeof tabs)[number];
type Package = NonNullable<PackageDetailResponse["package"]>;

export function TemplateDetailPage({
  detail,
  contents,
  fallbackOwner,
  llmAnalysis,
}: {
  detail: PackageDetailResponse;
  contents: string | null;
  fallbackOwner: string;
  llmAnalysis?: LlmAnalysis | null;
}) {
  const pkg = detail.package!;
  const { markdown, manifest } = useMemo(() => parseTemplateDocument(contents), [contents]);
  const [activeTab, setActiveTab] = useState<TemplateTab>("CLAW.md");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const summary = pkg.templateManifestSummary;
  const categories = (pkg.categories ?? manifest?.categories ?? []).map(
    (slug) =>
      TEMPLATE_CATEGORY_DEFINITIONS.find((category) => category.slug === slug)?.label ?? slug,
  );
  const description = pkg.summary ?? summary?.agent.description ?? manifest?.agent.description;
  const scanStatus = pkg.scanStatus ?? "pending";
  const ready = isTemplateReadyToAdd(scanStatus) && Boolean(pkg.latestVersion);
  const installCommand = "openclaw templates add " + pkg.name;
  // Package scanStatus still gates installation; an audit verdict needs release evidence.
  const auditVerdict = llmAnalysis ? aggregateAuditVerdict({ llmAnalysis }) : "unavailable";
  const securityLabel =
    (
      { benign: "Clean", clean: "Clean", review: "Review", malicious: "Malicious" } as Record<
        string,
        string
      >
    )[auditVerdict] ?? "Unavailable";
  const auditDescription =
    llmAnalysis?.summary || "No completed security audit is available for this release.";

  return (
    <main className="template-detail-page">
      <div className="template-detail-container">
        <header className="template-detail-hero">
          {categories.length ? (
            <p className="template-detail-category">{categories.join(" · ")}</p>
          ) : null}
          <h1>{summary?.agent.name || manifest?.agent.name || pkg.displayName}</h1>
          {description ? <p className="template-detail-description">{description}</p> : null}
          <div className="template-detail-publisher skill-hero-creator">
            <UserBadge
              user={detail.owner}
              fallbackHandle={fallbackOwner}
              prefix=""
              size="md"
              showName
              showMutedHandle
              stackMutedHandleBelowName
            />
          </div>
        </header>
        <div className="template-detail-layout">
          <div className="template-detail-main">
            <section className="template-detail-install" aria-label="Install Template">
              <InstallCommandCard
                cliCommand={installCommand}
                prompt={formatOpenClawPrompt(pkg.name, "template")}
                cliCopyAriaLabel="Copy template install command"
                copyEnabled={ready}
              />
            </section>
            <section className="template-detail-contents" aria-label="Template contents">
              <div className="template-detail-tabs" role="tablist" aria-label="Template contents">
                {tabs.map((tab, index) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    id={id + "-tab-" + index}
                    aria-controls={id + "-panel-" + index}
                    aria-selected={activeTab === tab}
                    tabIndex={activeTab === tab ? 0 : -1}
                    ref={(node) => {
                      tabRefs.current[index] = node;
                    }}
                    onClick={() => setActiveTab(tab)}
                    onKeyDown={(event) => {
                      let next = index;
                      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
                      else if (event.key === "ArrowLeft")
                        next = (index + tabs.length - 1) % tabs.length;
                      else if (event.key === "Home") next = 0;
                      else if (event.key === "End") next = tabs.length - 1;
                      else return;
                      event.preventDefault();
                      setActiveTab(tabs[next]);
                      tabRefs.current[next]?.focus();
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              {tabs.map((tab, index) => (
                <div
                  key={tab}
                  role="tabpanel"
                  id={id + "-panel-" + index}
                  aria-labelledby={id + "-tab-" + index}
                  tabIndex={0}
                  hidden={activeTab !== tab}
                  className="template-detail-panel"
                >
                  {activeTab === tab ? (
                    tab === "CLAW.md" ? (
                      markdown ? (
                        <MarkdownPreview className="template-detail-markdown">
                          {markdown}
                        </MarkdownPreview>
                      ) : (
                        <ContentMessage>
                          Template instructions are unavailable for this release.
                        </ContentMessage>
                      )
                    ) : !manifest ? (
                      <ContentMessage>
                        The manifest is unavailable for this release. Its contents could not be
                        read.
                      </ContentMessage>
                    ) : tab === "Skills" || tab === "Plugins" ? (
                      <TemplatePackages
                        manifest={manifest}
                        kind={tab === "Skills" ? "skill" : "plugin"}
                      />
                    ) : tab === "Automations" ? (
                      <TemplateAutomations manifest={manifest} />
                    ) : (
                      <TemplateWorkspace manifest={manifest} pkg={pkg} markdown={markdown} />
                    )
                  ) : null}
                </div>
              ))}
            </section>
          </div>
          <aside className="template-detail-metadata" aria-label="Template metadata">
            <SidebarMetadata
              ariaLabel="Template metadata"
              density="compact"
              blocks={[
                {
                  key: "security",
                  label: <DetailSecuritySummaryLabel />,
                  value: (
                    <div data-audit-verdict={auditVerdict} title={auditDescription}>
                      <div className="template-detail-security-value">
                        <span>{securityLabel}</span>
                        <div
                          className="security-audit-meter"
                          data-level={auditVerdictMeterLevel(auditVerdict)}
                          aria-hidden="true"
                        >
                          <span />
                          <span />
                          <span />
                        </div>
                      </div>
                      <span className="sr-only">{auditDescription}</span>
                    </div>
                  ),
                },
                {
                  grid: [
                    {
                      label: "Last updated",
                      value: (
                        <time dateTime={new Date(pkg.updatedAt).toISOString()}>
                          {new Date(pkg.updatedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            timeZone: "UTC",
                          })}
                        </time>
                      ),
                    },
                    {
                      label: "Current version",
                      value: pkg.latestVersion ? "v" + pkg.latestVersion : "Not available",
                    },
                  ],
                },
              ]}
            />
          </aside>
        </div>
      </div>
    </main>
  );
}

function ContentMessage({ children }: { children: React.ReactNode }) {
  return <p className="template-detail-content-message">{children}</p>;
}

function TemplatePackages({
  manifest,
  kind,
}: {
  manifest: TemplateManifest;
  kind: "skill" | "plugin";
}) {
  const packages = manifest.packages?.filter((entry) => entry.kind === kind) ?? [];
  if (!packages.length)
    return (
      <ContentMessage>
        No {kind === "skill" ? "skills" : "plugins"} are included in this Template.
      </ContentMessage>
    );
  return (
    <ul
      className="template-detail-entry-list"
      aria-label={kind === "skill" ? "Included skills" : "Included plugins"}
    >
      {packages.map((entry) => (
        <li key={entry.ref}>
          <strong>{entry.ref}</strong>
          <span className="template-detail-entry-meta">
            Version {entry.version} · {entry.source}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TemplateAutomations({ manifest }: { manifest: TemplateManifest }) {
  if (!manifest.automations?.length)
    return <ContentMessage>No automations are included in this Template.</ContentMessage>;
  return (
    <ul className="template-detail-entry-list" aria-label="Included automations">
      {manifest.automations.map((job) => (
        <li key={job.id}>
          <strong>{job.name || job.id}</strong>
          <span className="template-detail-entry-meta">
            <code>{job.schedule.cron}</code> · {job.schedule.timezone} · {job.session} session
          </span>
          <p className="template-detail-job-message">{job.message}</p>
          {job.delivery ? (
            <span className="template-detail-entry-meta">
              Delivery: {job.delivery.mode}
              {job.delivery.channel ? " · " + job.delivery.channel : ""}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function TemplateWorkspace({
  manifest,
  pkg,
  markdown,
}: {
  manifest: TemplateManifest;
  pkg: Package;
  markdown: string | null;
}) {
  const files: Array<{ path: string; source: string; contents?: string }> = [
    ...Object.entries(manifest.workspace?.bootstrapFiles ?? {}).map(([path, entry]) => ({
      path,
      source: entry.source,
    })),
    ...(manifest.workspace?.files ?? []),
  ];
  if (markdown?.trim() && !files.some((file) => file.path.toUpperCase() === "SOUL.MD")) {
    files.unshift({ path: "SOUL.md", source: "CLAW.md body", contents: markdown });
  }
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selectedFile = files.find((file) => file.path === selectedPath);
  const previewId = useId();
  const previewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selectedPath) return;
    previewRef.current?.focus({ preventScroll: true });
    previewRef.current?.scrollIntoView?.({ block: "start" });
  }, [selectedPath]);
  if (!files.length)
    return <ContentMessage>No workspace files are included in this Template.</ContentMessage>;
  return (
    <div className="template-detail-workspace">
      <ul className="template-detail-entry-list" aria-label="Included workspace files">
        {files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              aria-pressed={selectedPath === file.path}
              aria-expanded={selectedPath === file.path}
              aria-controls={selectedPath === file.path ? previewId : undefined}
              onClick={() => {
                setSelectedPath(file.path);
                if (selectedPath === file.path) {
                  previewRef.current?.focus({ preventScroll: true });
                  previewRef.current?.scrollIntoView?.({ block: "start" });
                }
              }}
            >
              {file.path}
            </button>
            <span className="template-detail-entry-meta">{file.source}</span>
            {selectedPath === file.path ? (
              <>
                {selectedFile?.contents !== undefined ? (
                  <section
                    id={previewId}
                    ref={previewRef}
                    tabIndex={-1}
                    className="template-detail-file-preview"
                    aria-label="Preview of SOUL.md"
                  >
                    <h3>SOUL.md</h3>
                    <MarkdownPreview className="template-detail-markdown">
                      {selectedFile.contents}
                    </MarkdownPreview>
                  </section>
                ) : selectedFile && pkg.latestVersion ? (
                  <WorkspaceFilePreview
                    key={selectedFile.source}
                    previewId={previewId}
                    previewRef={previewRef}
                    name={pkg.name}
                    version={pkg.latestVersion}
                    path={selectedFile.source}
                  />
                ) : null}
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorkspaceFilePreview({
  previewId,
  previewRef,
  name,
  version,
  path,
}: {
  previewId: string;
  previewRef: React.RefObject<HTMLElement | null>;
  name: string;
  version: string;
  path: string;
}) {
  const [state, setState] = useState<{ contents?: string | null; error?: boolean }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({});
    void fetchPackageFile(name, path, version).then(
      (contents) => {
        if (!cancelled) setState({ contents });
      },
      () => {
        if (!cancelled) setState({ error: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [name, path, version, attempt]);
  return (
    <section
      id={previewId}
      ref={previewRef}
      tabIndex={-1}
      className="template-detail-file-preview"
      aria-label={"Preview of " + path}
    >
      <h3>{path}</h3>
      {state.error ? (
        <p role="alert">
          Could not load this file.{" "}
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </p>
      ) : state.contents === undefined ? (
        <p role="status">Loading file…</p>
      ) : state.contents === null ? (
        <p>File preview is unavailable for this release.</p>
      ) : /\.md$/i.test(path) ? (
        <MarkdownPreview className="template-detail-markdown">{state.contents}</MarkdownPreview>
      ) : (
        <pre tabIndex={0}>
          <code>{state.contents}</code>
        </pre>
      )}
    </section>
  );
}
