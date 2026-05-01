import { createFileRoute, useSearch } from "@tanstack/react-router";
import type { PackageCompatibility } from "clawhub-schema";
import { useAction, useMutation, useQuery } from "convex/react";
import { startTransition, useEffect, useMemo, useState } from "react";
import semver from "semver";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { MAX_PUBLISH_FILE_BYTES, MAX_PUBLISH_TOTAL_BYTES } from "../../convex/lib/publishLimits";
import { InstallCopyButton } from "../components/InstallCopyButton";
import { Container } from "../components/layout/Container";
import { PackageLifecyclePanel } from "../components/PackageLifecyclePanel";
import { PackageSourceChooser } from "../components/PackageSourceChooser";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { derivePublishLifecycle } from "../lib/packageLifecycle";
import {
  buildPackageUploadEntries,
  filterIgnoredPackageFiles,
  normalizePackageUploadFiles,
} from "../lib/packageUpload";
import { derivePluginPrefill, listPrefilledFields } from "../lib/pluginPublishPrefill";
import { normalizeStorePackImport, type StorePackImportSummary } from "../lib/storepackImport";
import { expandFilesWithReport } from "../lib/uploadFiles";
import { useAuthStatus } from "../lib/useAuthStatus";
import { formatPublishError, hashFile, uploadFile } from "./upload/-utils";

export const Route = createFileRoute("/publish-plugin")({
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

type StorePackPreviewFile = {
  path: string;
  size: number;
  contentType?: string;
};

type StorePackPreview = {
  manifest: Record<string, unknown>;
  manifestJson: string;
  publishFiles: StorePackPreviewFile[];
  finalFileCount: number;
  selectedBytes: number;
  hostTargets: string[];
  environment: string[];
  blockers: string[];
  warnings: string[];
};

const DEFAULT_STOREPACK_TARGETS = ["darwin-arm64", "linux-x64-glibc", "win32-x64"];

function splitHostTargets(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function inferPreviewEnvironment(paths: string[]) {
  const lowerPaths = paths.map((path) => path.toLowerCase());
  const environment = [
    "network",
    lowerPaths.some((path) => path.includes("playwright") || path.includes("browser"))
      ? "browser"
      : null,
    lowerPaths.some((path) => path.includes("desktop") || path.includes("imessage"))
      ? "local desktop"
      : null,
    lowerPaths.some((path) => path.includes("audio") || path.includes("microphone"))
      ? "audio device"
      : null,
  ].filter((entry): entry is string => Boolean(entry));
  return [...new Set(environment)];
}

function hostTargetPreviewObjects(targets: string[], compatibility: PackageCompatibility | null) {
  return targets.map((target) => {
    const parts = target.toLowerCase().split(/[-_/]/).filter(Boolean);
    const os = parts.find((part) => part === "darwin" || part === "linux" || part === "win32");
    const arch = parts.find((part) => part === "arm64" || part === "x64");
    const libc = parts.find((part) => part === "glibc" || part === "musl");
    return {
      target,
      ...(os ? { os } : {}),
      ...(arch ? { arch } : {}),
      ...(libc ? { libc } : {}),
      supportState: os && arch ? "supported" : "setup-required",
      ...(compatibility?.minGatewayVersion
        ? { openclawRange: compatibility.minGatewayVersion }
        : {}),
      ...(compatibility?.pluginApiRange ? { pluginApiRange: compatibility.pluginApiRange } : {}),
    };
  });
}

function formatPreviewBytes(value: number) {
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${(value / (1024 * 1024)).toFixed(1)}MB`;
}

function buildStorePackPreview(input: {
  files: File[];
  normalizedPaths: string[];
  family: "code-plugin" | "bundle-plugin";
  name: string;
  displayName: string;
  ownerHandle: string;
  version: string;
  changelog: string;
  sourceRepo: string;
  sourceCommit: string;
  sourceRef: string;
  sourcePath: string;
  bundleFormat: string;
  hostTargets: string;
  compatibility: PackageCompatibility | null;
  codePluginFieldIssues: string[];
  validationError: string | null;
}): StorePackPreview | null {
  if (input.files.length === 0) return null;

  const normalized = normalizePackageUploadFiles(input.files);
  const publishFiles = normalized
    .filter((entry) => entry.path.toLowerCase() !== "storepack.json")
    .map((entry) => ({
      path: entry.path,
      size: entry.file.size,
      ...(entry.file.type ? { contentType: entry.file.type } : {}),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const selectedBytes = publishFiles.reduce((sum, file) => sum + file.size, 0);
  const suppliedStorePack = normalized.some(
    (entry) => entry.path.toLowerCase() === "storepack.json",
  );
  const rawTargets = input.family === "bundle-plugin" ? splitHostTargets(input.hostTargets) : [];
  const hostTargets = rawTargets.length > 0 ? rawTargets : DEFAULT_STOREPACK_TARGETS;
  const environment = inferPreviewEnvironment(input.normalizedPaths);
  const blockers = [
    input.validationError,
    input.name.trim() ? null : "Plugin name is required.",
    input.version.trim() ? null : "Version is required.",
    input.family === "code-plugin" && !input.sourceRepo.trim() ? "Source repo is required." : null,
    input.family === "code-plugin" && !input.sourceCommit.trim()
      ? "Source commit is required."
      : null,
    ...input.codePluginFieldIssues.map((field) => `Missing package metadata: ${field}.`),
  ].filter((entry): entry is string => Boolean(entry));
  const warnings = [
    input.changelog.trim() ? null : "Changelog is empty.",
    suppliedStorePack ? "STOREPACK.json supplied by package will be replaced by ClawHub." : null,
    rawTargets.length === 0 && input.family === "bundle-plugin"
      ? "No bundle host targets provided; ClawHub will fall back to the default host matrix."
      : null,
  ].filter((entry): entry is string => Boolean(entry));
  const source =
    input.sourceRepo.trim() && input.sourceCommit.trim()
      ? {
          kind: "github",
          repo: input.sourceRepo.trim(),
          ref: input.sourceRef.trim() || input.sourceCommit.trim(),
          commit: input.sourceCommit.trim(),
          path: input.sourcePath.trim() || ".",
        }
      : null;
  const manifest: Record<string, unknown> = {
    specVersion: 1,
    kind: "openclaw.storepack",
    package: {
      name: input.name.trim() || "unresolved",
      displayName: input.displayName.trim() || input.name.trim() || "unresolved",
      owner: input.ownerHandle.trim() || "resolved-on-publish",
      slug: input.name.trim() || "unresolved",
      version: input.version.trim() || "unresolved",
      family: input.family,
      channel: "community",
    },
    release: {
      packageId: "assigned-on-publish",
      releaseId: "assigned-on-publish",
      publishedAt: "assigned-on-publish",
      source,
    },
    artifact: {
      format: "zip",
      root: "package/",
      specVersion: 1,
      contentSha256: "computed-on-publish",
      fileCount: publishFiles.length,
    },
    files: publishFiles.map((file) => ({
      path: file.path,
      size: file.size,
      sha256: "computed-on-publish",
      ...(file.contentType ? { contentType: file.contentType } : {}),
    })),
    compatibility: input.compatibility ?? null,
    capabilities:
      input.family === "bundle-plugin"
        ? {
            format: input.bundleFormat.trim() || null,
            hostTargets,
          }
        : null,
    verification: { scanStatus: "pending" },
    hostTargets: hostTargetPreviewObjects(hostTargets, input.compatibility),
    environment: {
      requiresNetwork: true,
      requiresBrowser: environment.includes("browser"),
      requiresLocalDesktop: environment.includes("local desktop"),
      requiresAudioDevice: environment.includes("audio device"),
    },
    runtimeBundles: [],
  };

  return {
    manifest,
    manifestJson: JSON.stringify(manifest, null, 2),
    publishFiles,
    finalFileCount: publishFiles.length + 1,
    selectedBytes,
    hostTargets,
    environment,
    blockers,
    warnings,
  };
}

export function PublishPluginRoute() {
  const search = useSearch({ from: "/publish-plugin" });
  const { isAuthenticated } = useAuthStatus();
  const publishers = useQuery(api.publishers.listMine) as
    | Array<{
        publisher: {
          _id: string;
          handle: string;
          displayName: string;
          kind: "user" | "org";
        };
        role: "owner" | "admin" | "publisher";
      }>
    | undefined;
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
  const [sourceRepo, setSourceRepo] = useState(search.sourceRepo ?? "");
  const [sourceCommit, setSourceCommit] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [sourcePath, setSourcePath] = useState(".");
  const [bundleFormat, setBundleFormat] = useState("");
  const [hostTargets, setHostTargets] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [ignoredPaths, setIgnoredPaths] = useState<string[]>([]);
  const [storePackImport, setStorePackImport] = useState<StorePackImportSummary | null>(null);
  const [detectedPrefillFields, setDetectedPrefillFields] = useState<string[]>([]);
  const [codePluginFieldIssues, setCodePluginFieldIssues] = useState<string[]>([]);
  const [codePluginCompatibility, setCodePluginCompatibility] =
    useState<PackageCompatibility | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const isSubmitting = status !== null;
  const metadataDisabled = isMetadataLocked || isSubmitting;
  const storePackPreview = useMemo(
    () =>
      buildStorePackPreview({
        files,
        normalizedPaths,
        family,
        name,
        displayName,
        ownerHandle,
        version,
        changelog,
        sourceRepo,
        sourceCommit,
        sourceRef,
        sourcePath,
        bundleFormat,
        hostTargets,
        compatibility: codePluginCompatibility,
        codePluginFieldIssues,
        validationError,
      }),
    [
      files,
      normalizedPaths,
      family,
      name,
      displayName,
      ownerHandle,
      version,
      changelog,
      sourceRepo,
      sourceCommit,
      sourceRef,
      sourcePath,
      bundleFormat,
      hostTargets,
      codePluginCompatibility,
      codePluginFieldIssues,
      validationError,
    ],
  );
  const publishLifecycle = useMemo(
    () =>
      derivePublishLifecycle({
        hasFiles: files.length > 0,
        isAuthenticated,
        blockers: storePackPreview?.blockers ?? [],
        status,
      }),
    [files.length, isAuthenticated, storePackPreview, status],
  );

  const onPickFiles = async (selected: File[]) => {
    try {
      const expanded = await expandFilesWithReport(selected, {
        includeBinaryArchiveFiles: true,
      });
      const filtered = await filterIgnoredPackageFiles(expanded.files);
      const imported = await normalizeStorePackImport(filtered.files);
      const selectedFiles = imported.summary ? imported.files : filtered.files;
      const normalized = normalizePackageUploadFiles(selectedFiles);
      const nextIgnoredPaths = [
        ...new Set([...expanded.ignoredMacJunkPaths, ...filtered.ignoredPaths]),
      ];
      setFiles(selectedFiles);
      setIgnoredPaths(nextIgnoredPaths);
      setStorePackImport(imported.summary);
      setError(null);
      const prefill = await derivePluginPrefill(normalized);
      setDetectedPrefillFields(listPrefilledFields(prefill));
      setCodePluginFieldIssues(prefill.missingRequiredFields ?? []);
      setCodePluginCompatibility(prefill.compatibility ?? null);
      if (imported.summary?.family ?? prefill.family) {
        setFamily((imported.summary?.family ?? prefill.family) as "code-plugin" | "bundle-plugin");
      }
      if (imported.summary?.packageName ?? prefill.name) {
        setName(imported.summary?.packageName ?? prefill.name ?? "");
      }
      if (imported.summary?.displayName ?? prefill.displayName) {
        setDisplayName(imported.summary?.displayName ?? prefill.displayName ?? "");
      }
      if (imported.summary?.version ?? prefill.version) {
        setVersion(imported.summary?.version ?? prefill.version ?? "");
      }
      if (imported.summary?.sourceRepo ?? prefill.sourceRepo) {
        setSourceRepo(imported.summary?.sourceRepo ?? prefill.sourceRepo ?? "");
      }
      if (imported.summary?.sourceCommit) setSourceCommit(imported.summary.sourceCommit);
      if (imported.summary?.sourceRef) setSourceRef(imported.summary.sourceRef);
      if (imported.summary?.sourcePath) setSourcePath(imported.summary.sourcePath);
      if (prefill.bundleFormat) setBundleFormat(prefill.bundleFormat);
      if (imported.summary?.hostTargets.length) {
        setHostTargets(imported.summary.hostTargets.join(", "));
      } else if (prefill.hostTargets) setHostTargets(prefill.hostTargets);
    } catch (pickError) {
      setFiles([]);
      setIgnoredPaths([]);
      setStorePackImport(null);
      setDetectedPrefillFields([]);
      setCodePluginFieldIssues([]);
      setCodePluginCompatibility(null);
      setError(formatPublishError(pickError));
    }
  };

  useEffect(() => {
    if (ownerHandle) return;
    const personal =
      publishers?.find((entry) => entry.publisher.kind === "user") ?? publishers?.[0];
    if (personal?.publisher.handle) {
      setOwnerHandle(personal.publisher.handle);
    }
  }, [ownerHandle, publishers]);

  return (
    <main className="py-10">
      <Container>
        <header className="mb-6">
          <h1 className="mb-2 font-display text-2xl font-bold text-[color:var(--ink)]">
            {search.name ? "Publish Plugin Release" : "Publish Plugin"}
          </h1>
          <p className="text-sm text-[color:var(--ink-soft)]">
            Publish a native code plugin or bundle plugin release.
          </p>
          <p className="text-sm text-[color:var(--ink-soft)]">
            New releases stay private until automated security checks and verification finish.
          </p>
          {search.name ? (
            <p className="text-sm text-[color:var(--ink-soft)]">
              Prefilled for {search.displayName ?? search.name}
              {search.nextVersion && semver.valid(search.nextVersion)
                ? ` \u00b7 suggested ${search.nextVersion}`
                : ""}
            </p>
          ) : null}
        </header>

        <PackageSourceChooser
          files={files}
          totalBytes={totalBytes}
          normalizedPaths={normalizedPaths}
          normalizedPathSet={normalizedPathSet}
          ignoredPaths={ignoredPaths}
          detectedPrefillFields={detectedPrefillFields}
          family={family}
          validationError={validationError}
          codePluginFieldIssues={codePluginFieldIssues}
          codePluginCompatibility={codePluginCompatibility}
          storePackImport={storePackImport}
          hostTargets={hostTargets}
          onPickFiles={onPickFiles}
        />

        <div className="mb-5">
          <PackageLifecyclePanel lifecycle={publishLifecycle} title="Plugin release lifecycle" />
        </div>

        {storePackPreview ? (
          <Card className="mb-5">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
                    StorePack preview
                  </h2>
                  <p className="mt-1 text-sm text-[color:var(--ink-soft)]">
                    This is the generated package contract ClawHub will build on publish.
                  </p>
                </div>
                <InstallCopyButton
                  text={storePackPreview.manifestJson}
                  ariaLabel="Copy StorePack preview manifest"
                />
              </div>

              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] p-3">
                  <dt className="mb-1 text-[color:var(--ink-soft)]">Final archive</dt>
                  <dd className="font-semibold text-[color:var(--ink)]">
                    {storePackPreview.finalFileCount} files including STOREPACK.json
                  </dd>
                </div>
                <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] p-3">
                  <dt className="mb-1 text-[color:var(--ink-soft)]">Selected size</dt>
                  <dd className="font-semibold text-[color:var(--ink)]">
                    {formatPreviewBytes(storePackPreview.selectedBytes)}
                  </dd>
                </div>
                <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] p-3">
                  <dt className="mb-1 text-[color:var(--ink-soft)]">Publish state</dt>
                  <dd className="font-semibold text-[color:var(--ink)]">
                    {publishLifecycle.label}
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-1.5">
                {storePackPreview.hostTargets.map((target) => (
                  <Badge key={target} variant="compact">
                    {target}
                  </Badge>
                ))}
                {storePackPreview.environment.map((signal) => (
                  <Badge key={signal} variant="compact">
                    {signal}
                  </Badge>
                ))}
              </div>

              {storePackPreview.blockers.length > 0 ? (
                <div className="rounded-[var(--radius-sm)] border border-red-300/50 bg-red-50 p-3 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-100">
                  <strong>Blocking issues</strong>
                  <ul className="mt-2 list-disc pl-5">
                    {storePackPreview.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {storePackPreview.warnings.length > 0 ? (
                <div className="rounded-[var(--radius-sm)] border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
                  <strong>Warnings</strong>
                  <ul className="mt-2 list-disc pl-5">
                    {storePackPreview.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <strong className="text-sm text-[color:var(--ink)]">STOREPACK.json</strong>
                  <span className="text-xs text-[color:var(--ink-soft)]">
                    digests computed after upload
                  </span>
                </div>
                <pre className="max-h-[420px] overflow-auto rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-4 text-xs leading-5 text-[color:var(--ink)]">
                  <code>{storePackPreview.manifestJson}</code>
                </pre>
              </div>
            </div>
          </Card>
        ) : null}

        <Card
          className={isMetadataLocked ? "pointer-events-none opacity-60" : ""}
          aria-disabled={isMetadataLocked}
        >
          <div className="flex flex-col gap-3">
            {!isAuthenticated ? (
              <div className="text-sm text-[color:var(--ink-soft)]">Log in to publish plugins.</div>
            ) : null}
            <p className="text-sm text-[color:var(--ink-soft)]">
              {isMetadataLocked
                ? "Upload plugin code to detect the package shape and unlock the release form."
                : "Metadata detected and prefilled. Review it, then fill any missing release details."}
            </p>
            <select
              className="min-h-[44px] w-full rounded-[var(--radius-sm)] border border-[rgba(29,59,78,0.22)] bg-[rgba(255,255,255,0.94)] px-3.5 py-[13px] text-sm text-[color:var(--ink)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[rgba(255,255,255,0.12)] dark:bg-[rgba(14,28,37,0.84)]"
              value={family}
              disabled={metadataDisabled}
              onChange={(event) => setFamily(event.target.value as never)}
            >
              <option value="code-plugin">Code plugin</option>
              <option value="bundle-plugin">Bundle plugin</option>
            </select>
            <Input
              placeholder="Plugin name"
              value={name}
              disabled={metadataDisabled}
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              placeholder="Display name"
              value={displayName}
              disabled={metadataDisabled}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <select
              className="min-h-[44px] w-full rounded-[var(--radius-sm)] border border-[rgba(29,59,78,0.22)] bg-[rgba(255,255,255,0.94)] px-3.5 py-[13px] text-sm text-[color:var(--ink)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[rgba(255,255,255,0.12)] dark:bg-[rgba(14,28,37,0.84)]"
              value={ownerHandle}
              disabled={metadataDisabled}
              onChange={(event) => setOwnerHandle(event.target.value)}
            >
              {(publishers ?? []).map((entry) => (
                <option key={entry.publisher._id} value={entry.publisher.handle}>
                  @{entry.publisher.handle} &middot; {entry.publisher.displayName}
                </option>
              ))}
            </select>
            <Input
              placeholder="Version"
              value={version}
              disabled={metadataDisabled}
              onChange={(event) => setVersion(event.target.value)}
            />
            <Textarea
              placeholder="Changelog"
              rows={4}
              value={changelog}
              disabled={metadataDisabled}
              onChange={(event) => setChangelog(event.target.value)}
            />
            <Input
              placeholder="Source repo (owner/repo)"
              value={sourceRepo}
              disabled={metadataDisabled}
              onChange={(event) => setSourceRepo(event.target.value)}
            />
            <Input
              placeholder="Source commit"
              value={sourceCommit}
              disabled={metadataDisabled}
              onChange={(event) => setSourceCommit(event.target.value)}
            />
            <Input
              placeholder="Source ref (tag or branch)"
              value={sourceRef}
              disabled={metadataDisabled}
              onChange={(event) => setSourceRef(event.target.value)}
            />
            <Input
              placeholder="Source path"
              value={sourcePath}
              disabled={metadataDisabled}
              onChange={(event) => setSourcePath(event.target.value)}
            />
            {family === "bundle-plugin" ? (
              <>
                <Input
                  placeholder="Bundle format"
                  value={bundleFormat}
                  disabled={metadataDisabled}
                  onChange={(event) => setBundleFormat(event.target.value)}
                />
                <Input
                  placeholder="Host targets (comma separated)"
                  value={hostTargets}
                  disabled={metadataDisabled}
                  onChange={(event) => setHostTargets(event.target.value)}
                />
              </>
            ) : null}
            <Button
              variant="primary"
              disabled={
                !isAuthenticated ||
                isMetadataLocked ||
                !name.trim() ||
                !version.trim() ||
                files.length === 0 ||
                Boolean(validationError) ||
                isSubmitting ||
                (family === "code-plugin" &&
                  (!sourceRepo.trim() || !sourceCommit.trim() || codePluginFieldIssues.length > 0))
              }
              onClick={() => {
                startTransition(() => {
                  void (async () => {
                    try {
                      if (validationError) {
                        toast.error(validationError);
                        return;
                      }
                      if (family === "code-plugin" && codePluginFieldIssues.length > 0) {
                        toast.error(
                          `Missing required OpenClaw package metadata: ${codePluginFieldIssues.join(", ")}`,
                        );
                        return;
                      }
                      setStatus("Uploading files...");
                      setError(null);
                      const uploaded = await buildPackageUploadEntries(files, {
                        generateUploadUrl,
                        hashFile,
                        uploadFile,
                      });
                      setStatus("Publishing release...");
                      await publishRelease({
                        payload: {
                          name: name.trim(),
                          displayName: displayName.trim() || undefined,
                          ownerHandle: ownerHandle || undefined,
                          family,
                          version: version.trim(),
                          changelog: changelog.trim(),
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
                      setStatus(
                        "Published. Pending security checks and verification before public listing.",
                      );
                    } catch (publishError) {
                      toast.error(formatPublishError(publishError));
                      setStatus(null);
                    }
                  })();
                });
              }}
            >
              {status ?? "Publish"}
            </Button>
            {error ? <Badge variant="accent">{error}</Badge> : null}
          </div>
        </Card>
      </Container>
    </main>
  );
}
