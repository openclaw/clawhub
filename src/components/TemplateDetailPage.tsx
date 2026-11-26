import { templateDependencyInventory, type TemplateDependencyInventory } from "clawhub-schema";
import {
  getTemplateCategoryLabel,
  resolveDeclaredTemplateCategory,
} from "clawhub-schema/catalogMetadata";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { MarketplaceIcon } from "./MarketplaceIcon";
import { OfficialBadge } from "./OfficialBadge";
import type { LlmAnalysis } from "./securityAuditModel";
import { formatOpenClawPrompt } from "./skillDetailUtils";
import { InstallCommandCard } from "./SkillInstallSurface";
import { TemplatePersonality, TemplateReleaseInventory } from "./TemplateReleaseInventory";
import "./template-catalog-detail.css";
import "./template-detail.css";

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
  // Render release dates in UTC for SSR, then in the visitor’s local zone after hydration.
  const [deviceZone, setDeviceZone] = useState<string>();
  useEffect(() => setDeviceZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  const explicitSoul =
    display?.contents.instructions.find((file) => file.name === "SOUL.md")?.source ??
    manifest?.workspace?.bootstrapFiles?.["SOUL.md"]?.source ??
    manifest?.workspace?.files?.find((file) => file.path === "SOUL.md")?.source;
  // The manifest body is the implicit SOUL unless a workspace mapping overrides it.
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
        summary={description}
        sidebar={
          <>
            {installSurface}
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
        <TemplateReleaseInventory
          documentLoading={documentLoading}
          packageName={pkg.name}
          releaseVersion={pkg.latestVersion}
          display={display}
          manifest={supportedManifest ? manifest : null}
          dependencies={display || supportedManifest ? (inventory ?? []) : []}
          workspace={display || supportedManifest ? workspaceContents : null}
          personality={soul?.trim() ? <TemplatePersonality markdown={soul} /> : null}
        />
      </CatalogDetailLayout>
    </main>
  );
}
