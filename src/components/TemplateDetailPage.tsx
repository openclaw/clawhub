import {
  templateDependencyInventory,
  type TemplateDependencyInventory,
  type TemplateManifest,
} from "clawhub-schema";
import {
  getTemplateCategoryLabel,
  resolveDeclaredTemplateCategory,
} from "clawhub-schema/catalogMetadata";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { formatCompactStat } from "../lib/numberFormat";
import { buildPublisherProfileHref } from "../lib/ownerRoute";
import {
  fetchPackageFile,
  getPackageArtifactDownloadPath,
  getPackageDownloadPath,
  type PackageDetailResponse,
} from "../lib/packageApi";
import {
  parseTemplateDocument,
  templateWorkspaceContents,
  workspaceContentsFromDestinations,
  type TemplateWorkspaceContents,
  type TemplateWorkspaceEntry,
} from "../lib/templateDetail";
import type { TemplateDisplayInventory } from "../lib/templateDisplayInventory";
import {
  buildTemplateInstallRef,
  buildTemplateSecurityAuditHref,
  isTemplateReadyToAdd,
} from "../lib/templateRoutes";
import {
  CatalogDetailBreadcrumb,
  CatalogDetailFact,
  CatalogDetailLayout,
} from "./CatalogDetailLayout";
import { DetailSecuritySummary, DetailSecuritySummaryLabel } from "./DetailSecuritySummary";
import { MarkdownPreview } from "./MarkdownPreview";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { OfficialBadge } from "./OfficialBadge";
import { PackageContentTabs } from "./PackageContentTabs";
import type { LlmAnalysis } from "./securityAuditModel";
import { formatOpenClawPrompt } from "./skillDetailUtils";
import { InstallCommandCard } from "./SkillInstallSurface";
import { TemplatePersonality, TemplateReleaseInventory } from "./TemplateReleaseInventory";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import "./template-catalog-detail.css";
import "./template-detail.css";

type Package = NonNullable<PackageDetailResponse["package"]>;

export function TemplateDetailPage({
  detail,
  contents: suppliedContents,
  inventory: display,
  fallbackOwner,
  llmAnalysis,
  pendingNotice,
}: {
  detail: PackageDetailResponse;
  contents: string | null;
  inventory?: TemplateDisplayInventory;
  fallbackOwner: string;
  llmAnalysis?: LlmAnalysis | null;
  pendingNotice?: ReactNode;
}) {
  const pkg = detail.package!;
  const [documentResult, setDocumentResult] = useState<{
    contents: string | null;
    failed?: boolean;
  }>();
  const [documentAttempt, setDocumentAttempt] = useState(0);
  const manifestPath = display?.manifestPath,
    version = display?.version;
  useEffect(() => {
    if (!version || !manifestPath) return undefined;
    let active = true;
    void fetchPackageFile(pkg.name, manifestPath, version).then(
      (raw) => {
        if (active) setDocumentResult({ contents: raw });
      },
      () => {
        if (active) setDocumentResult({ contents: null, failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [pkg.name, manifestPath, version, documentAttempt]);
  const documentLoading = Boolean(display) && !documentResult;
  const contents = display ? (documentResult?.contents ?? null) : suppliedContents;
  const { markdown, manifest } = useMemo(() => parseTemplateDocument(contents), [contents]);
  const summary = display?.templateManifestSummary ?? pkg.templateManifestSummary;
  const inventory: TemplateDependencyInventory | null = display
    ? [
        ...display.contents.skills.map((row) => ({ ...row, kind: "skill" as const })),
        ...display.contents.integrations.filter((row) => row.kind === "plugin"),
      ]
    : (pkg.templateInventory ?? (manifest ? templateDependencyInventory(manifest) : null));
  const workspaceContents = useMemo(
    () =>
      display
        ? workspaceContentsFromDestinations(
            display.contents.instructions.map((row) => row.name),
            manifest?.agent.heartbeat?.every,
          )
        : manifest
          ? templateWorkspaceContents(manifest)
          : null,
    [display, manifest],
  );
  // Before the registry assigns a category, show only what CLAW.md can assign: its first
  // declared slug, and only when that is in the current taxonomy.
  const declaredCategory = resolveDeclaredTemplateCategory(manifest?.categories);
  const categories = (pkg.categories ?? (declaredCategory ? [declaredCategory] : [])).map(
    getTemplateCategoryLabel,
  );
  const description = summary?.agent.description ?? manifest?.agent.description ?? pkg.summary;
  const scanStatus = pkg.scanStatus ?? "pending";
  // Historical summaries retain profile counts even when CLAW.md alone still parses.
  const retiredProfile = (summary?.profiles?.count ?? 0) > 0;
  const supportedManifest = Boolean(manifest) && !retiredProfile && !detail.templateDisplayOnly;
  const ready =
    supportedManifest &&
    isTemplateReadyToAdd(scanStatus) &&
    (!display || isTemplateReadyToAdd(display.security.trust.scanStatus)) &&
    Boolean(pkg.latestVersion);
  const manifestWarning =
    !documentLoading && !documentResult?.failed && !supportedManifest && pkg.latestVersion
      ? retiredProfile
        ? "This release includes retired Template profiles and cannot be added."
        : contents === null
          ? "The CLAW.md manifest could not be loaded, so this release cannot be added. Reload this page to try again."
          : "This release has an unsupported or invalid CLAW.md manifest and cannot be added."
      : null;
  const archivePath = pkg.latestVersion
    ? pkg.artifact?.kind === "npm-pack"
      ? getPackageArtifactDownloadPath(pkg.name, pkg.latestVersion)
      : getPackageDownloadPath(pkg.name, pkg.latestVersion)
    : null;
  const installRef = buildTemplateInstallRef(pkg.name, detail.owner?.handle ?? fallbackOwner);

  const installSurface = (
    <section className="template-detail-install" aria-label="Install Template">
      <InstallCommandCard
        cliCommand={"openclaw templates add " + installRef}
        prompt={formatOpenClawPrompt(installRef, "template")}
        cliCopyAriaLabel="Copy template install command"
        copyEnabled={ready}
        desktopInstall={ready ? { family: "templates", name: installRef } : undefined}
      />
      {manifestWarning ? (
        <p className="template-detail-install-warning" role="status">
          {manifestWarning} Ask the publisher to migrate or repair CLAW.md and publish a new
          version. <a href="/docs/templates">Template migration guide</a>.
          {archivePath ? (
            <>
              {" "}
              <a href={archivePath}>Download release archive</a>.
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );

  const owner = detail.owner?.handle ?? fallbackOwner;
  const title = summary?.agent.name || manifest?.agent.name || pkg.displayName;
  const auditHref = buildTemplateSecurityAuditHref(pkg.name, owner, pkg.latestVersion)!;
  const [browseFiles, setBrowseFiles] = useState(false);
  // SSR uses UTC. Once hydrated, the rail and Add preview use the same local zone as Control UI.
  const [deviceZone, setDeviceZone] = useState<string>();
  useEffect(() => setDeviceZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  const explicitSoul =
    display?.contents.instructions.find((file) => file.name === "SOUL.md")?.source ??
    manifest?.workspace?.bootstrapFiles?.["SOUL.md"]?.source ??
    manifest?.workspace?.files?.find((file) => file.path === "SOUL.md")?.source;
  // SOUL is the only file whose body is part of the detail page; other file reads require selection.
  const soulPath = explicitSoul && explicitSoul !== "CLAW.md#body" ? explicitSoul : null;
  const [explicitSoulText, setExplicitSoulText] = useState<string | null>(null);
  useEffect(() => {
    if (!soulPath || !pkg.latestVersion || !supportedManifest) return undefined;
    let active = true;
    void fetchPackageFile(pkg.name, soulPath, pkg.latestVersion).then(
      (text) => {
        if (active) setExplicitSoulText(text);
      },
      () => {
        if (active) setExplicitSoulText(null);
      },
    );
    return () => {
      active = false;
    };
  }, [soulPath, pkg.name, pkg.latestVersion, supportedManifest]);
  const soul = supportedManifest ? (soulPath ? explicitSoulText : markdown) : null;
  const releaseBrowser = (
    <PackageContentTabs
      routeKind="template"
      renderPanel={(tab) =>
        tab === "CLAW.md" ? (
          <>
            {documentLoading ? (
              <p role="status">Loading Template instructions…</p>
            ) : documentResult?.failed ? (
              <p role="alert">
                Could not load Template instructions.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setDocumentResult(undefined);
                    setDocumentAttempt((n) => n + 1);
                  }}
                >
                  Try again
                </button>
              </p>
            ) : markdown ? (
              <MarkdownPreview className="template-detail-markdown">{markdown}</MarkdownPreview>
            ) : (
              <ContentMessage>
                Template instructions are unavailable for this release.
              </ContentMessage>
            )}
            {!supportedManifest && contents !== null ? (
              <details className="template-detail-original">
                <summary>View original CLAW.md</summary>
                <pre>
                  <code>{contents}</code>
                </pre>
              </details>
            ) : null}
          </>
        ) : !display && (!supportedManifest || !manifest) ? (
          <ContentMessage>
            The manifest is unavailable in the current Template format. See the original CLAW.md and
            migration guidance before asking the publisher for a new version.
          </ContentMessage>
        ) : tab === "Skills" || tab === "Plugins" ? (
          <TemplatePackages
            inventory={inventory ?? []}
            kind={tab === "Skills" ? "skill" : "plugin"}
            workspace={
              (tab === "Skills" ? workspaceContents?.skills : workspaceContents?.plugins) ?? []
            }
          />
        ) : tab === "Automations" ? (
          <TemplateAutomations
            manifest={manifest}
            schedules={display?.contents.automations}
            heartbeat={workspaceContents?.heartbeat ?? null}
          />
        ) : (
          <TemplateWorkspace
            manifest={manifest}
            projected={display?.contents.instructions}
            pkg={pkg}
            markdown={markdown}
            documentLoading={documentLoading}
          />
        )
      }
    />
  );
  const fileTrigger = (
    <DialogTrigger asChild>
      <button type="button" className="template-catalog-file" onClick={() => setBrowseFiles(!soul)}>
        {soul ? "SOUL.md" : "Browse release files"}
      </button>
    </DialogTrigger>
  );
  const releaseDate = (value: number) => (
    <time dateTime={new Date(value).toISOString()}>
      {new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeZone: deviceZone ?? "UTC",
      }).format(value)}
    </time>
  );
  return (
    <main className="catalog-detail-page template-catalog-page">
      <CatalogDetailLayout
        className="template-catalog-detail"
        breadcrumb={<CatalogDetailBreadcrumb href="/templates" label="Templates" current={title} />}
        title={title}
        icon={<MarketplaceIcon kind="template" label={pkg.name} imageUrl={pkg.icon} />}
        publisher={
          <>
            <a
              href={buildPublisherProfileHref(owner)}
              title={detail.owner?.displayName ?? undefined}
            >
              {owner === "openclaw" ? <strong>OpenClaw </strong> : null}@{owner}
            </a>
            {detail.owner?.official && <OfficialBadge iconOnly size={14} />}
          </>
        }
        actions={
          <Dialog>
            <DialogTrigger asChild>
              <button type="button" className="template-catalog-add" disabled={!ready}>
                Add
              </button>
            </DialogTrigger>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Add Template</DialogTitle>
              {installSurface}
            </DialogContent>
          </Dialog>
        }
        summary={description}
        sidebar={
          <>
            <CatalogDetailFact label={<DetailSecuritySummaryLabel />}>
              <DetailSecuritySummary
                auditHref={auditHref}
                llmAnalysis={llmAnalysis}
                githubScanStatus={display?.security.verdict ?? "Unavailable"}
                description={
                  display?.security.overview ||
                  llmAnalysis?.summary ||
                  "No completed security audit is available for this release."
                }
              />
            </CatalogDetailFact>
            <CatalogDetailFact label="Version">
              {pkg.latestVersion ?? "Not available"}
            </CatalogDetailFact>
            <CatalogDetailFact label="Updated">{releaseDate(pkg.updatedAt)}</CatalogDetailFact>
            <CatalogDetailFact label="Published">{releaseDate(pkg.createdAt)}</CatalogDetailFact>
            {pkg.stats?.downloads !== undefined && (
              <CatalogDetailFact label="Downloads">
                {formatCompactStat(pkg.stats.downloads)}
              </CatalogDetailFact>
            )}
            {categories.length > 0 && (
              <CatalogDetailFact label="Categories">
                {categories.map((category) => (
                  <span key={category} className="template-catalog-category">
                    {category}
                  </span>
                ))}
              </CatalogDetailFact>
            )}
          </>
        }
      >
        {pendingNotice}
        {!ready && !documentLoading && installSurface}
        {documentLoading && <p role="status">Loading Template instructions…</p>}
        {documentResult?.failed && (
          <p role="alert">
            Could not load Template instructions.{" "}
            <button
              type="button"
              onClick={() => {
                setDocumentResult(undefined);
                setDocumentAttempt((n) => n + 1);
              }}
            >
              Try again
            </button>
          </p>
        )}
        {!supportedManifest && contents !== null && (
          <details className="template-detail-original">
            <summary>View original CLAW.md</summary>
            <pre>
              <code>{contents}</code>
            </pre>
          </details>
        )}
        <Dialog>
          <TemplateReleaseInventory
            packageName={pkg.name}
            releaseVersion={pkg.latestVersion}
            deviceZone={deviceZone}
            display={display}
            manifest={supportedManifest ? manifest : null}
            dependencies={display || supportedManifest ? (inventory ?? []) : []}
            workspace={display || supportedManifest ? workspaceContents : null}
            personality={
              soul ? <TemplatePersonality markdown={soul} fileAction={fileTrigger} /> : fileTrigger
            }
          />
          <DialogContent className="template-catalog-file-dialog" aria-describedby={undefined}>
            <DialogTitle>{soul && !browseFiles ? "SOUL.md" : "Release files"}</DialogTitle>
            {soul && !browseFiles ? (
              <>
                <button
                  type="button"
                  className="template-catalog-browse"
                  onClick={() => setBrowseFiles(true)}
                >
                  Browse release files
                </button>
                <MarkdownPreview className="template-catalog-document">{soul}</MarkdownPreview>
              </>
            ) : (
              releaseBrowser
            )}
          </DialogContent>
        </Dialog>
      </CatalogDetailLayout>
    </main>
  );
}

function ContentMessage({ children }: { children: React.ReactNode }) {
  return <p className="template-detail-content-message">{children}</p>;
}

function TemplatePackages({
  inventory,
  kind,
  workspace,
}: {
  inventory: TemplateDependencyInventory;
  kind: "skill" | "plugin";
  workspace: TemplateWorkspaceEntry[];
}) {
  const packages = inventory.filter((entry) => entry.kind === kind);
  const total = packages.length + workspace.length;
  if (!total)
    return (
      <ContentMessage>
        No {kind === "skill" ? "skills" : "plugins"} are included in this Template.
      </ContentMessage>
    );
  return (
    <>
      <p className="template-detail-entry-meta">
        {total} included {total === 1 ? kind : kind + "s"}
      </p>
      <ul
        className="template-detail-entry-list"
        aria-label={kind === "skill" ? "Included skills" : "Included plugins"}
      >
        {packages.map((entry) =>
          entry.source === "bundled" ? (
            <li key={entry.path}>
              <strong>{entry.name || entry.path}</strong>
              <span className="template-detail-entry-meta">
                Bundled · <code>{entry.path}</code>
              </span>
            </li>
          ) : (
            <li key={entry.ref}>
              <strong>{entry.ref}</strong>
              <span className="template-detail-entry-meta">Version {entry.version} · ClawHub</span>
            </li>
          ),
        )}
        {/* Installed through workspace.files rather than declared as a dependency. */}
        {workspace.map((entry) => (
          <li key={"workspace:" + entry.path}>
            <strong>{entry.name}</strong>
            <span className="template-detail-entry-meta">
              Workspace file · <code>{entry.path}</code>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function TemplateAutomations({
  manifest,
  schedules,
  heartbeat,
}: {
  manifest: TemplateManifest | null;
  schedules?: TemplateDisplayInventory["contents"]["automations"];
  heartbeat: TemplateWorkspaceContents["heartbeat"];
}) {
  if (!(schedules?.length || manifest?.automations?.length) && !heartbeat)
    return <ContentMessage>No automations are included in this Template.</ContentMessage>;
  return (
    <ul className="template-detail-entry-list" aria-label="Included automations">
      {!manifest &&
        schedules?.map((job, i) => (
          <li key={job.name + ":" + i}>
            <strong>{job.name}</strong>
            <span className="template-detail-entry-meta">
              {job.enabled ? "Enabled" : "Paused"} · <code>{job.schedule}</code> · {job.timezone}
            </span>
          </li>
        ))}
      {(manifest?.automations ?? []).map((job) => (
        <li key={job.id}>
          <strong>{job.name || job.id}</strong>
          <span className="template-detail-entry-meta">
            {job.enabled === false ? "Paused" : "Enabled"} · <code>{job.schedule.cron}</code> ·{" "}
            {job.schedule.timezone} · {job.session} session
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
      {heartbeat ? (
        <li>
          <strong>Heartbeat checklist</strong>
          <span className="template-detail-entry-meta">
            Workspace file · <code>{heartbeat.path}</code>
            {heartbeat.every ? " · Every " + heartbeat.every : ""}
          </span>
          <p className="template-detail-job-message">
            OpenClaw converts this checklist into interval automations when the Template is added.
          </p>
        </li>
      ) : null}
    </ul>
  );
}

function TemplateWorkspace({
  manifest,
  projected,
  pkg,
  markdown,
  documentLoading,
}: {
  manifest: TemplateManifest | null;
  projected?: TemplateDisplayInventory["contents"]["instructions"];
  documentLoading?: boolean;
  pkg: Package;
  markdown: string | null;
}) {
  const files: Array<{ path: string; source: string; contents?: string }> = projected
    ? projected.map((row) => ({
        path: row.name,
        source: row.source,
        ...(row.source === "CLAW.md#body" && markdown ? { contents: markdown } : {}),
      }))
    : [
        ...Object.entries(manifest?.workspace?.bootstrapFiles ?? {}).map(([path, entry]) => ({
          path,
          source: entry.source,
        })),
        ...(manifest?.workspace?.files ?? []),
      ];
  if (
    !projected &&
    markdown?.trim() &&
    !files.some((file) => file.path.toUpperCase() === "SOUL.MD")
  ) {
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
                ) : selectedFile?.source === "CLAW.md#body" ? (
                  <p id={previewId} role="status">
                    {documentLoading
                      ? "Loading Template instructions…"
                      : "The release document body is unavailable."}
                  </p>
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
