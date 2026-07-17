import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { DocsLinks, getPackageScopeOwnerMismatch, isPluginCategorySlug } from "clawhub-schema";
import { useAction, useMutation, useQuery } from "convex/react";
import { ExternalLink, Info, Lock } from "lucide-react";
import { type ReactNode, startTransition, useEffect, useMemo, useRef, useState } from "react";
import semver from "semver";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { MAX_PUBLISH_FILE_BYTES, MAX_PUBLISH_TOTAL_BYTES } from "../../../convex/lib/publishLimits";
import {
  CatalogMetadataFields,
  formatCatalogTopicsInput,
  parseCatalogTopicsInput,
} from "../../components/CatalogMetadataFields";
import { EmptyState } from "../../components/EmptyState";
import { Container } from "../../components/layout/Container";
import {
  PackageSourceChooser,
  type PackagePickSource,
} from "../../components/PackageSourceChooser";
import {
  PublisherOwnerSelect,
  type PublisherOwnerMembership,
} from "../../components/PublisherOwnerSelect";
import { PublishFormSkeleton } from "../../components/PublishFormSkeleton";
import { SignInButton } from "../../components/SignInButton";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { VersionInput } from "../../components/VersionInput";
import {
  detectRelativeReadmeAssets,
  type RelativeReadmeAssetReport,
} from "../../lib/detectRelativeReadmeAssets";
import {
  buildPackageUploadEntries,
  filterIgnoredPackageFiles,
  normalizePackageUploadFiles,
} from "../../lib/packageUpload";
import { derivePluginPrefill, listPrefilledFields } from "../../lib/pluginPublishPrefill";
import { buildReadmeAssetBaseUrl } from "../../lib/readmeAssetBaseUrl";
import { expandFilesWithReport } from "../../lib/uploadFiles";
import { useAuthStatus } from "../../lib/useAuthStatus";
import { formatPublishError, hashFile, uploadFile } from "../upload/-utils";

export const Route = createFileRoute("/plugins/publish")({
  validateSearch: (search) => ({
    ownerHandle: typeof search.ownerHandle === "string" ? search.ownerHandle : undefined,
    name: typeof search.name === "string" ? search.name : undefined,
    displayName: typeof search.displayName === "string" ? search.displayName : undefined,
    family:
      search.family === "code-plugin" || search.family === "bundle-plugin"
        ? search.family
        : undefined,
    nextVersion: typeof search.nextVersion === "string" ? search.nextVersion : undefined,
    sourceRepo: typeof search.sourceRepo === "string" ? search.sourceRepo : undefined,
  }),
  component: PublishPluginRoute,
});

const apiRefs = api as unknown as {
  packages: {
    publishRelease: unknown;
  };
};

const SHOW_CLAWPACK_ONBOARDING_BANNER = false;
const PLUGIN_PUBLISHING_GUIDE_URL = "https://docs.openclaw.ai/clawhub/publishing#plugins";

function findReadmeFile(files: File[]): File | null {
  // Match the same lookup the publish backend uses (readme.md / readme.mdx)
  // by going through the shared upload-path normalizer so we see the exact
  // path the server will see — including any shared-top-level-folder
  // stripping. We pick the shallowest README so root-level READMEs win over
  // ones nested in `examples/` etc.
  const normalized = normalizePackageUploadFiles(files);
  const candidates: Array<{ file: File; depth: number }> = [];
  for (const entry of normalized) {
    const lower = entry.path.toLowerCase();
    if (lower === "readme.md" || lower === "readme.mdx") {
      candidates.push({ file: entry.file, depth: 1 });
      continue;
    }
    const segments = lower.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last === "readme.md" || last === "readme.mdx") {
      candidates.push({ file: entry.file, depth: segments.length });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.depth - b.depth);
  return candidates[0]?.file ?? null;
}

const EMPTY_README_ASSET_REPORT: RelativeReadmeAssetReport = {
  samples: [],
  total: 0,
  unresolvableSamples: [],
  unresolvableTotal: 0,
};

async function scanReadmeRelativeAssets(files: File[]): Promise<RelativeReadmeAssetReport> {
  const readme = findReadmeFile(files);
  if (!readme) return EMPTY_README_ASSET_REPORT;
  try {
    const text = await readme.text();
    return detectRelativeReadmeAssets(text);
  } catch {
    return EMPTY_README_ASSET_REPORT;
  }
}

type ParsedInspectorPublishError = {
  summary: string;
  findings: Array<{ code: string; message: string }>;
};

const PLUGIN_INSPECTOR_BLOCKED_PREFIX = "Plugin Inspector blocked publish:";

function parsePluginInspectorPublishError(message: string): ParsedInspectorPublishError | null {
  if (!message.startsWith(PLUGIN_INSPECTOR_BLOCKED_PREFIX)) return null;
  const body = message.slice(PLUGIN_INSPECTOR_BLOCKED_PREFIX.length).trim();
  if (!body) return { summary: "Hard findings blocked this publish.", findings: [] };
  const [summaryPart, ...detailParts] = body.split(". ");
  const summary = summaryPart?.trim() || "Hard findings blocked this publish.";
  const details = detailParts.join(". ").trim();
  if (!details) return { summary, findings: [] };
  const findings = details
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^([a-z0-9._-]+):\s+(.+)$/i);
      return match
        ? { code: match[1]!, message: match[2]! }
        : { code: "plugin-inspector", message: part };
    });
  return { summary, findings };
}

function isPluginInspectorPublishError(message: string) {
  return Boolean(parsePluginInspectorPublishError(message));
}

function PluginPublishError({ message }: { message: string }) {
  const inspectorError = parsePluginInspectorPublishError(message);
  if (!inspectorError) {
    return (
      <div className="plugin-publish-error-text" role="alert">
        {message}
      </div>
    );
  }

  return (
    <div className="plugin-publish-error-panel" role="alert">
      <div className="plugin-publish-error-heading">
        <strong>Plugin Inspector blocked publish</strong>
        <span>{inspectorError.summary}</span>
      </div>
      {inspectorError.findings.length > 0 ? (
        <div className="plugin-publish-error-table-wrap">
          <table className="plugin-publish-error-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Message</th>
              </tr>
            </thead>
            <tbody>
              {inspectorError.findings.map((finding) => (
                <tr key={`${finding.code}:${finding.message}`}>
                  <td>
                    <code>{finding.code}</code>
                  </td>
                  <td>{finding.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function PublishPluginRoute() {
  const search = useSearch({ from: "/plugins/publish" });
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: isAuthLoading, me } = useAuthStatus();
  const publishers = useQuery(api.publishers.listMine, me ? {} : "skip") as
    | Array<PublisherOwnerMembership>
    | undefined;
  const existing = useQuery(
    api.packages.getManageContext,
    me && search.name ? { name: search.name } : "skip",
  );
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const publishRelease = useAction(apiRefs.packages.publishRelease as never) as unknown as (args: {
    payload: unknown;
  }) => Promise<unknown>;
  const [family, setFamily] = useState<"code-plugin" | "bundle-plugin">(
    search.family === "bundle-plugin" ? "bundle-plugin" : "code-plugin",
  );
  const [name, setName] = useState(search.name ?? "");
  const [displayName, setDisplayName] = useState(search.displayName ?? "");
  const [ownerHandle, setOwnerHandle] = useState(search.ownerHandle ?? "");
  const [version, setVersion] = useState(search.nextVersion ?? "0.1.0");
  const [changelog, setChangelog] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [suggestedCategories, setSuggestedCategories] = useState<string[]>();
  const [topics, setTopics] = useState("");
  const categoriesTouchedRef = useRef(false);
  const topicsTouchedRef = useRef(false);
  const [sourceRepo, setSourceRepo] = useState(search.sourceRepo ?? "");
  const [sourceCommit, setSourceCommit] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [sourcePath, setSourcePath] = useState(".");
  const [bundleFormat, setBundleFormat] = useState("");
  const [hostTargets, setHostTargets] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [packageSourceKind, setPackageSourceKind] = useState<PackagePickSource | null>(null);
  const [ignoredPaths, setIgnoredPaths] = useState<string[]>([]);
  const [detectedPrefillFields, setDetectedPrefillFields] = useState<string[]>([]);
  const [readmeAssetReport, setReadmeAssetReport] =
    useState<RelativeReadmeAssetReport>(EMPTY_README_ASSET_REPORT);
  const [codePluginFieldIssues, setCodePluginFieldIssues] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showChangelogField = Boolean(search.name);

  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const normalizedPaths = useMemo(
    () => normalizePackageUploadFiles(files).map((entry) => entry.path),
    [files],
  );
  const normalizedPathSet = useMemo(
    () => new Set(normalizedPaths.map((path) => path.toLowerCase())),
    [normalizedPaths],
  );
  const oversizedFiles = useMemo(
    () => files.filter((file) => file.size > MAX_PUBLISH_FILE_BYTES),
    [files],
  );
  const oversizedFileNames = useMemo(
    () => oversizedFiles.slice(0, 3).map((file) => file.name),
    [oversizedFiles],
  );
  const validationError =
    oversizedFiles.length > 0
      ? `Each file must be 10MB or smaller: ${oversizedFileNames.join(", ")}`
      : totalBytes > MAX_PUBLISH_TOTAL_BYTES
        ? "Total file size exceeds 50MB."
        : null;
  const isMetadataLocked = files.length === 0;
  const isNewPluginPublishEmpty = files.length === 0 && !search.name;
  const metadataDisabled = isMetadataLocked || isSubmitting;
  const ownerScopeError = useMemo(() => {
    return getPackageScopeOwnerMismatch(name, ownerHandle)?.message ?? null;
  }, [name, ownerHandle]);
  const submitBlockers = useMemo(() => {
    if (isMetadataLocked) return [];
    const blockers: string[] = [];
    if (!name.trim()) blockers.push("Plugin name is required.");
    if (!version.trim()) blockers.push("Version is required.");
    if (family === "code-plugin") {
      if (!sourceRepo.trim()) blockers.push("GitHub repository is required.");
      if (!sourceCommit.trim()) blockers.push("Commit SHA is required.");
    }
    return blockers;
  }, [family, isMetadataLocked, name, sourceCommit, sourceRepo, version]);
  const hasPackageBlocker =
    Boolean(validationError) || Boolean(ownerScopeError) || codePluginFieldIssues.length > 0;
  const hasPublished =
    status?.startsWith("Published.") || status?.startsWith("Publish received.") || false;
  const isPublishDisabled =
    !isAuthenticated ||
    isMetadataLocked ||
    hasPackageBlocker ||
    submitBlockers.length > 0 ||
    isSubmitting ||
    hasPublished;
  const publishBlockerSummary = useMemo(() => {
    if (isSubmitting) return null;
    if (!isAuthenticated) return "Sign in to publish.";
    if (isMetadataLocked) return "Complete plugin files to publish.";
    if (validationError) return `Fix: ${validationError}`;
    if (ownerScopeError) return `Fix: ${ownerScopeError}`;
    if (codePluginFieldIssues.length > 0) {
      return `Fix package metadata: ${formatInlineList(codePluginFieldIssues)}.`;
    }
    const missing = submitBlockers.flatMap(missingPluginPublishLabel);
    const uniqueMissing = [...new Set(missing)];
    if (uniqueMissing.length > 0) {
      return `Complete ${formatInlineList(uniqueMissing)} to publish.`;
    }
    return null;
  }, [
    codePluginFieldIssues,
    isAuthenticated,
    isMetadataLocked,
    isSubmitting,
    ownerScopeError,
    submitBlockers,
    validationError,
  ]);

  const readmeAssetWarning = useMemo(() => {
    const { total, unresolvableTotal, samples, unresolvableSamples } = readmeAssetReport;
    if (total === 0) return null;
    const resolvableTotal = total - unresolvableTotal;
    // Single source of truth: only treat the source metadata as "filled" when
    // buildReadmeAssetBaseUrl — the same function the renderer uses — accepts
    // it and produces a real raw.githubusercontent.com URL. This catches the
    // silent-drop trap where the form previously accepted any non-empty Commit
    // SHA (e.g. a 7-char short SHA, a tag like `v1.0.0`, a non-GitHub URL, or
    // a `..`-laden Package path) and reassured the publisher their relative
    // images would be served, while at render time COMMIT_SHA / owner-repo /
    // path validation would silently drop the base URL and the detail page
    // would 404. By gating on resolvedBaseUrl we keep the form's promise and
    // the renderer's behavior in lock-step.
    const resolvedBaseUrl = buildReadmeAssetBaseUrl(sourceRepo, sourceCommit, sourcePath);
    const hasSource = Boolean(resolvedBaseUrl);
    const showResolvableMissingSource = resolvableTotal > 0 && !hasSource;
    const showSourcePathReminder = resolvableTotal > 0 && hasSource;
    const showUnresolvable = unresolvableTotal > 0;
    if (!showResolvableMissingSource && !showSourcePathReminder && !showUnresolvable) {
      return null;
    }
    const resolvableSamples = samples.filter((sample) => !unresolvableSamples.includes(sample));
    return {
      total,
      samples,
      resolvableTotal,
      resolvableSamples,
      unresolvableTotal,
      unresolvableSamples,
      resolvedBaseUrl,
      showResolvableMissingSource,
      showSourcePathReminder,
      showUnresolvable,
    };
  }, [readmeAssetReport, sourceRepo, sourceCommit, sourcePath]);

  const onPickFiles = async (selected: File[], sourceKind: PackagePickSource) => {
    const expanded = await expandFilesWithReport(selected, {
      includeBinaryArchiveFiles: true,
    });
    const filtered = await filterIgnoredPackageFiles(expanded.files);
    const normalized = normalizePackageUploadFiles(filtered.files);
    const nextIgnoredPaths = [
      ...new Set([...expanded.ignoredLocalMetadataPaths, ...filtered.ignoredPaths]),
    ];
    setFiles(filtered.files);
    setPackageSourceKind(sourceKind);
    setIgnoredPaths(nextIgnoredPaths);
    setError(null);
    setStatus(null);
    setReadmeAssetReport(await scanReadmeRelativeAssets(filtered.files));
    const prefill = await derivePluginPrefill(normalized);
    setDetectedPrefillFields(listPrefilledFields(prefill));
    setCodePluginFieldIssues(prefill.missingRequiredFields ?? []);
    setSuggestedCategories(prefill.suggestedCategories);
    if (prefill.family === "code-plugin") setFamily(prefill.family);
    if (prefill.name) setName(prefill.name);
    if (prefill.displayName) setDisplayName(prefill.displayName);
    if (prefill.version) setVersion(prefill.version);
    if (prefill.sourceRepo) setSourceRepo(prefill.sourceRepo);
    if (prefill.bundleFormat) setBundleFormat(prefill.bundleFormat);
    if (prefill.hostTargets) setHostTargets(prefill.hostTargets);
  };

  const clearSelectedFiles = () => {
    setFiles([]);
    setPackageSourceKind(null);
    setIgnoredPaths([]);
    setDetectedPrefillFields([]);
    setCodePluginFieldIssues([]);
    setSuggestedCategories(undefined);
    // Without this reset the README warning Badge keeps showing the previous
    // package's relative-asset findings until the next pick's async scan
    // finishes — which is misleading both while no package is selected and
    // during the brief window between setFiles() and setReadmeAssetReport()
    // inside onPickFiles().
    setReadmeAssetReport(EMPTY_README_ASSET_REPORT);
    setError(null);
    setStatus(null);
  };

  useEffect(() => {
    if (ownerHandle) return;
    const personal =
      publishers?.find((entry) => entry.publisher.kind === "user") ?? publishers?.[0];
    if (personal?.publisher.handle) {
      setOwnerHandle(personal.publisher.handle);
    }
  }, [ownerHandle, publishers]);

  useEffect(() => {
    if (!existing?.package) return;
    if (!categoriesTouchedRef.current) {
      const nextCategories = (existing.package.categories ?? []).filter(isPluginCategorySlug);
      setCategories((current) =>
        current.length === nextCategories.length &&
        current.every((category, index) => category === nextCategories[index])
          ? current
          : nextCategories,
      );
    }
    if (!topicsTouchedRef.current) {
      const nextTopics = formatCatalogTopicsInput(existing.package.topics ?? []);
      setTopics((current) => (current === nextTopics ? current : nextTopics));
    }
  }, [existing]);

  if (isAuthLoading) {
    return <PublishFormSkeleton />;
  }

  if (!isAuthenticated || !me) {
    return (
      <main className="py-10">
        <Container size="narrow">
          <EmptyState
            title="Sign in to publish a plugin"
            description="You need to be signed in to publish plugins on ClawHub."
          >
            <SignInButton />
          </EmptyState>
        </Container>
      </main>
    );
  }

  return (
    <main className={isNewPluginPublishEmpty ? "publish-empty-main" : "py-10"}>
      <Container
        size="narrow"
        className={isNewPluginPublishEmpty ? "publish-empty-container" : undefined}
      >
        <header
          className={
            isNewPluginPublishEmpty
              ? "publish-empty-header"
              : "mb-7 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
          }
        >
          <div className={isNewPluginPublishEmpty ? "publish-empty-heading" : undefined}>
            <h1 className="mb-2 font-display text-2xl font-bold text-[color:var(--ink)]">
              {search.name ? "Publish Plugin Release" : "Publish Plugin"}
            </h1>
            <p className="text-sm text-[color:var(--ink-soft)]">
              {isNewPluginPublishEmpty
                ? "Publish your plugin to ClawHub so others can discover and install it."
                : "Review the detected plugin details before publishing."}
            </p>
            {search.name ? (
              <p className="text-sm text-[color:var(--ink-soft)]">
                Prefilled for {search.displayName ?? search.name}
                {search.nextVersion && semver.valid(search.nextVersion)
                  ? ` \u00b7 suggested ${search.nextVersion}`
                  : ""}
              </p>
            ) : null}
          </div>
          <div
            className={
              isNewPluginPublishEmpty
                ? "publish-empty-actions flex flex-wrap items-center gap-2"
                : "flex flex-wrap items-center gap-2"
            }
          >
            <Button asChild variant="outline" size="sm" className="w-fit">
              <a href={PLUGIN_PUBLISHING_GUIDE_URL} target="_blank" rel="noreferrer">
                Plugin docs
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </Button>
          </div>
        </header>

        {SHOW_CLAWPACK_ONBOARDING_BANNER ? (
          <Card className="mb-5 border-[rgba(255,107,74,0.3)] bg-[rgba(255,107,74,0.06)]">
            <p className="text-sm font-medium text-[color:var(--ink)]">
              ClawPack publishing is moving to npm-pack .tgz uploads.
            </p>
            <p className="mt-1 text-sm text-[color:var(--ink-soft)]">
              Use the CLI for exact ClawPack bytes while the web uploader remains on the legacy
              compatibility path.
            </p>
          </Card>
        ) : null}

        <PackageSourceChooser
          files={files}
          totalBytes={totalBytes}
          normalizedPaths={normalizedPaths}
          normalizedPathSet={normalizedPathSet}
          selectedSourceKind={packageSourceKind}
          ignoredPaths={ignoredPaths}
          detectedPrefillFields={detectedPrefillFields}
          family={family}
          validationError={validationError}
          codePluginFieldIssues={codePluginFieldIssues}
          onPickFiles={onPickFiles}
          onClearFiles={clearSelectedFiles}
          emptyStateLayout={isNewPluginPublishEmpty}
        />

        {!isNewPluginPublishEmpty ? (
          <div className="contents">
            <Card
              className={isMetadataLocked ? "pointer-events-none opacity-60" : ""}
              aria-disabled={isMetadataLocked}
            >
              <div className="flex flex-col gap-5">
                <div className="grid gap-x-4 gap-y-4 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="pluginName">Plugin name</Label>
                    <Input
                      id="pluginName"
                      placeholder="Plugin name"
                      value={name}
                      disabled={metadataDisabled}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="pluginDisplayName">Display name</Label>
                    <Input
                      id="pluginDisplayName"
                      placeholder="Display name"
                      value={displayName}
                      disabled={metadataDisabled}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="pluginFamily">Package type</Label>
                    <div
                      id="pluginFamily"
                      className="min-h-[44px] w-full rounded-[var(--radius-sm)] border border-[rgba(29,59,78,0.22)] bg-[rgba(255,255,255,0.94)] px-3.5 py-[13px] text-sm text-[color:var(--ink)] dark:border-[rgba(255,255,255,0.12)] dark:bg-[rgba(14,28,37,0.84)]"
                    >
                      {family === "code-plugin" ? "Code plugin" : "Bundle plugin"}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="pluginVersion">Version</Label>
                    <VersionInput
                      id="pluginVersion"
                      placeholder="Version"
                      value={version}
                      disabled={metadataDisabled}
                      onValueChange={setVersion}
                    />
                  </div>
                  <CatalogMetadataFields
                    kind="plugin"
                    categories={categories}
                    suggestedCategories={suggestedCategories}
                    topics={topics}
                    disabled={metadataDisabled}
                    onCategoriesChange={(nextCategories) => {
                      categoriesTouchedRef.current = true;
                      setCategories(nextCategories);
                    }}
                    onTopicsChange={(nextTopics) => {
                      topicsTouchedRef.current = true;
                      setTopics(nextTopics);
                    }}
                  />
                  {family === "bundle-plugin" ? (
                    <>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="pluginBundleFormat">Bundle format</Label>
                        <Input
                          id="pluginBundleFormat"
                          placeholder="Bundle format"
                          value={bundleFormat}
                          disabled={metadataDisabled}
                          onChange={(event) => setBundleFormat(event.target.value)}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="pluginHostTargets">Host targets</Label>
                        <Input
                          id="pluginHostTargets"
                          placeholder="Host targets (comma separated)"
                          value={hostTargets}
                          disabled={metadataDisabled}
                          onChange={(event) => setHostTargets(event.target.value)}
                        />
                      </div>
                    </>
                  ) : null}
                  {ownerScopeError ? (
                    <Badge variant="warning" className="md:col-span-2">
                      <span>{ownerScopeError}</span>
                      <a
                        href={DocsLinks.clawhub.packageScopeFaq}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        Learn how publishing works
                      </a>
                    </Badge>
                  ) : null}
                  <div className="flex flex-col gap-2 md:col-span-2">
                    <Label htmlFor="pluginOwner">Publishing as</Label>
                    <PublisherOwnerSelect
                      id="pluginOwner"
                      value={ownerHandle}
                      memberships={publishers}
                      disabled={metadataDisabled}
                      onValueChange={setOwnerHandle}
                    />
                  </div>
                </div>
              </div>
            </Card>

            <Card
              className={`mt-5 ${isMetadataLocked ? "pointer-events-none opacity-60" : ""}`}
              aria-disabled={isMetadataLocked}
            >
              <div className="flex flex-col gap-5">
                <div>
                  <h2 className="font-display text-lg font-bold leading-tight text-[color:var(--ink)]">
                    Source
                  </h2>
                </div>
                <div className="grid gap-x-4 gap-y-4 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <FieldLabelWithHelp
                      htmlFor="pluginSourceRepo"
                      help="Use owner/repo, for example openclaw/demo-plugin."
                    >
                      GitHub repository
                    </FieldLabelWithHelp>
                    <Input
                      id="pluginSourceRepo"
                      placeholder="owner/repo"
                      value={sourceRepo}
                      disabled={metadataDisabled}
                      onChange={(event) => setSourceRepo(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <FieldLabelWithHelp
                      htmlFor="pluginSourceCommit"
                      help="Use the exact Git commit SHA for this release, preferably the full hash."
                    >
                      Commit SHA
                    </FieldLabelWithHelp>
                    <Input
                      id="pluginSourceCommit"
                      placeholder="Full commit SHA"
                      value={sourceCommit}
                      disabled={metadataDisabled}
                      onChange={(event) => setSourceCommit(event.target.value)}
                    />
                    {readmeAssetWarning ? (
                      <Badge variant="accent">
                        <span>
                          {readmeAssetWarning.showResolvableMissingSource ? (
                            <>
                              Your README references{" "}
                              {readmeAssetWarning.resolvableTotal === 1
                                ? "a package-relative image path"
                                : `${readmeAssetWarning.resolvableTotal} package-relative image paths`}{" "}
                              ({readmeAssetWarning.resolvableSamples.slice(0, 3).join(", ")}
                              {readmeAssetWarning.resolvableSamples.length > 3 ? ", \u2026" : ""}).
                              Without Source repo + Commit SHA the plugin detail page can't resolve
                              them to your source host, so they will 404. Fill in GitHub repository
                              + Commit SHA (and Package path if the package isn't at the repo root)
                              to serve them from raw.githubusercontent.com, or rewrite them to
                              absolute URLs in the README.
                            </>
                          ) : null}
                          {readmeAssetWarning.showSourcePathReminder &&
                          readmeAssetWarning.resolvedBaseUrl ? (
                            <>
                              Your README references{" "}
                              {readmeAssetWarning.resolvableTotal === 1
                                ? "a package-relative image path"
                                : `${readmeAssetWarning.resolvableTotal} package-relative image paths`}{" "}
                              ({readmeAssetWarning.resolvableSamples.slice(0, 3).join(", ")}
                              {readmeAssetWarning.resolvableSamples.length > 3 ? ", \u2026" : ""}).
                              They will be served from {readmeAssetWarning.resolvedBaseUrl} — make
                              sure Package path matches where this package lives in the repo, or the
                              images will 404.
                            </>
                          ) : null}
                          {(readmeAssetWarning.showResolvableMissingSource ||
                            readmeAssetWarning.showSourcePathReminder) &&
                          readmeAssetWarning.showUnresolvable
                            ? " "
                            : null}
                          {readmeAssetWarning.showUnresolvable ? (
                            <>
                              Your README also references{" "}
                              {readmeAssetWarning.unresolvableTotal === 1
                                ? "a root-absolute image path"
                                : `${readmeAssetWarning.unresolvableTotal} root-absolute image paths`}{" "}
                              ({readmeAssetWarning.unresolvableSamples.slice(0, 3).join(", ")}
                              {readmeAssetWarning.unresolvableSamples.length > 3 ? ", \u2026" : ""}
                              ). These start with "/" and are resolved against the page origin, not
                              the package, so Source repo + Commit SHA cannot rewrite them — please
                              replace them with absolute URLs or package-relative paths in the
                              README.
                            </>
                          ) : null}
                        </span>
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2">
                    <FieldLabelWithHelp
                      htmlFor="pluginSourceRef"
                      help="Optional tag or branch that points at the release source."
                    >
                      Tag or branch
                    </FieldLabelWithHelp>
                    <Input
                      id="pluginSourceRef"
                      placeholder="v1.0.0 or main"
                      value={sourceRef}
                      disabled={metadataDisabled}
                      onChange={(event) => setSourceRef(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <FieldLabelWithHelp
                      htmlFor="pluginSourcePath"
                      help="Use . when the package is at the repo root; otherwise use its subfolder path."
                    >
                      Package path
                    </FieldLabelWithHelp>
                    <Input
                      id="pluginSourcePath"
                      placeholder="."
                      value={sourcePath}
                      disabled={metadataDisabled}
                      onChange={(event) => setSourcePath(event.target.value)}
                    />
                  </div>
                </div>
              </div>
            </Card>

            {showChangelogField ? (
              <Card
                className={`mt-5 ${isMetadataLocked ? "pointer-events-none opacity-60" : ""}`}
                aria-disabled={isMetadataLocked}
              >
                <div>
                  <h2 className="font-display text-lg font-bold leading-tight text-[color:var(--ink)]">
                    Changelog
                  </h2>
                  <p className="mt-1 text-sm text-[color:var(--ink-soft)]">
                    Summarize what changed in this release.
                  </p>
                </div>
                <Label htmlFor="pluginChangelog" className="sr-only">
                  Changelog
                </Label>
                <Textarea
                  id="pluginChangelog"
                  placeholder="Describe what changed in this release..."
                  rows={4}
                  value={changelog}
                  disabled={metadataDisabled}
                  onChange={(event) => setChangelog(event.target.value)}
                />
              </Card>
            ) : null}

            <div className="mt-5 flex items-center justify-between gap-4">
              <div className="flex flex-col gap-2">
                {error ? <PluginPublishError message={error} /> : null}
                {status ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">{status}</div>
                ) : null}
                {!status ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    New releases stay private until automated security checks and verification
                    finish.
                  </div>
                ) : null}
                {publishBlockerSummary ? (
                  <div className="text-sm font-medium text-status-error-fg">
                    {publishBlockerSummary}
                  </div>
                ) : null}
              </div>
              <Button
                variant="primary"
                size="lg"
                type="button"
                disabled={isPublishDisabled}
                loading={isSubmitting}
                onClick={() => {
                  startTransition(() => {
                    void (async () => {
                      try {
                        if (validationError) {
                          toast.error(validationError);
                          return;
                        }
                        if (ownerScopeError) {
                          toast.error(ownerScopeError);
                          return;
                        }
                        if (family === "code-plugin" && codePluginFieldIssues.length > 0) {
                          toast.error(
                            `Missing required OpenClaw package metadata: ${codePluginFieldIssues.join(", ")}`,
                          );
                          return;
                        }
                        setIsSubmitting(true);
                        setError(null);
                        const uploaded = await buildPackageUploadEntries(files, {
                          generateUploadUrl,
                          hashFile,
                          uploadFile,
                        });
                        const result = await publishRelease({
                          payload: {
                            name: name.trim(),
                            displayName: displayName.trim() || undefined,
                            ownerHandle: ownerHandle || undefined,
                            family,
                            version: version.trim(),
                            changelog: changelog.trim(),
                            ...(categories.length || categoriesTouchedRef.current
                              ? { categories }
                              : {}),
                            ...(topics.trim() || topicsTouchedRef.current
                              ? { topics: parseCatalogTopicsInput(topics) }
                              : {}),
                            ...(sourceRepo.trim() && sourceCommit.trim()
                              ? {
                                  source: {
                                    kind: "github" as const,
                                    repo: sourceRepo.trim(),
                                    url: sourceRepo.trim().startsWith("http")
                                      ? sourceRepo.trim()
                                      : `https://github.com/${sourceRepo.trim().replace(/^\/+|\/+$/g, "")}`,
                                    ref: sourceRef.trim() || sourceCommit.trim(),
                                    commit: sourceCommit.trim(),
                                    path: sourcePath.trim() || ".",
                                    importedAt: Date.now(),
                                  },
                                }
                              : {}),
                            ...(family === "bundle-plugin"
                              ? {
                                  bundle: {
                                    format: bundleFormat.trim() || undefined,
                                    hostTargets: hostTargets
                                      .split(",")
                                      .map((entry) => entry.trim())
                                      .filter(Boolean),
                                  },
                                }
                              : {}),
                            files: uploaded,
                          },
                        });
                        if (
                          result &&
                          typeof result === "object" &&
                          "status" in result &&
                          result.status === "pending"
                        ) {
                          setStatus(null);
                          void navigate({ to: "/dashboard" });
                        } else {
                          setStatus(
                            "Published. Pending security checks and verification before public listing.",
                          );
                        }
                      } catch (publishError) {
                        const message = formatPublishError(publishError);
                        setError(message);
                        if (!isPluginInspectorPublishError(message)) {
                          toast.error(message);
                        }
                        setStatus(null);
                      } finally {
                        setIsSubmitting(false);
                      }
                    })();
                  });
                }}
              >
                {isPublishDisabled && !isSubmitting ? (
                  <Lock className="h-4 w-4" aria-hidden="true" />
                ) : null}
                Publish plugin
              </Button>
            </div>
          </div>
        ) : null}
      </Container>
    </main>
  );
}

function FieldLabelWithHelp(props: { htmlFor: string; help: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={props.htmlFor}>{props.children}</Label>
      <span
        tabIndex={0}
        role="img"
        aria-label={`Help: ${props.help}`}
        title={props.help}
        className="inline-flex cursor-help text-[color:var(--ink-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </div>
  );
}

function formatInlineList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function missingPluginPublishLabel(issue: string) {
  if (issue === "Plugin name is required.") return ["plugin name"];
  if (issue === "Version is required.") return ["version"];
  if (issue === "GitHub repository is required.") return ["GitHub repository"];
  if (issue === "Commit SHA is required.") return ["commit SHA"];
  return [];
}
