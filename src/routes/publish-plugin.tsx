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
import { PackageSourceChooser } from "../components/PackageSourceChooser";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { normalizeClawPackImport, type ClawPackImportSummary } from "../lib/clawpackImport";
import {
  fetchGitHubPackageSource,
  type GitHubPackageSourceProgress,
} from "../lib/githubPackageSource";
import {
  buildPackageUploadEntries,
  filterIgnoredPackageFiles,
  normalizePackageUploadFiles,
} from "../lib/packageUpload";
import { derivePluginPrefill, listPrefilledFields } from "../lib/pluginPublishPrefill";
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

type ClawPackPreviewFile = {
  path: string;
  size: number;
  contentType?: string;
};

type ClawPackPreview = {
  manifest: Record<string, unknown>;
  manifestJson: string;
  publishFiles: ClawPackPreviewFile[];
  finalFileCount: number;
  selectedBytes: number;
  hostTargets: string[];
  environment: string[];
  blockers: string[];
  warnings: string[];
};

type ClawPackIntakeGate = {
  label: string;
  status: "ready" | "review" | "blocked" | "pending";
  detail: string;
};

type PublishSuccess = {
  name: string;
  version: string;
  releaseId?: string;
};

const DEFAULT_CLAWPACK_TARGETS = ["darwin-arm64", "linux-x64-glibc", "win32-x64"];

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

function formatGitHubSourceProgress(progress: GitHubPackageSourceProgress) {
  if (progress.phase === "resolving") return "Resolving GitHub repo and commit...";
  if (progress.phase === "listing") return "Reading GitHub package file list...";
  if (progress.phase === "downloading") {
    const count =
      typeof progress.current === "number" && typeof progress.total === "number"
        ? `${progress.current}/${progress.total}`
        : "";
    return `Downloading GitHub files${count ? ` ${count}` : ""}${
      progress.path ? `: ${progress.path}` : ""
    }`;
  }
  return "Fetching GitHub package...";
}

function buildClawPackPreview(input: {
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
}): ClawPackPreview | null {
  if (input.files.length === 0) return null;

  const normalized = normalizePackageUploadFiles(input.files);
  const publishFiles = normalized
    .filter((entry) => entry.path.toLowerCase() !== "clawpack.json")
    .map((entry) => ({
      path: entry.path,
      size: entry.file.size,
      ...(entry.file.type ? { contentType: entry.file.type } : {}),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const selectedBytes = publishFiles.reduce((sum, file) => sum + file.size, 0);
  const suppliedClawPack = normalized.some((entry) => entry.path.toLowerCase() === "clawpack.json");
  const rawTargets = input.family === "bundle-plugin" ? splitHostTargets(input.hostTargets) : [];
  const hostTargets = rawTargets.length > 0 ? rawTargets : DEFAULT_CLAWPACK_TARGETS;
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
    suppliedClawPack ? "Existing pack manifest will be replaced by ClawHub." : null,
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
    kind: "openclaw.clawpack",
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

function buildClawPackIntakeGates(input: {
  preview: ClawPackPreview;
  family: "code-plugin" | "bundle-plugin";
  sourceRepo: string;
  sourceCommit: string;
  sourceRef: string;
}) {
  const hasSource = Boolean(input.sourceRepo.trim() && input.sourceCommit.trim());
  const defaultMatrix =
    input.family === "bundle-plugin" &&
    input.preview.hostTargets.length === DEFAULT_CLAWPACK_TARGETS.length &&
    input.preview.hostTargets.every((target, index) => target === DEFAULT_CLAWPACK_TARGETS[index]);
  return [
    {
      label: "Archive contract",
      status: input.preview.blockers.length > 0 ? "blocked" : "ready",
      detail:
        input.preview.blockers.length > 0
          ? "Resolve blocking metadata before ClawHub can build the canonical Claw Pack."
          : `${input.preview.finalFileCount} files will be packaged with a generated manifest and digests.`,
    },
    {
      label: "Source provenance",
      status: hasSource ? "ready" : "blocked",
      detail: hasSource
        ? `${input.sourceRepo.trim()} @ ${input.sourceRef.trim() || input.sourceCommit.trim()}`
        : "Code plugins require a source repository and exact commit for review and future rebuild checks.",
    },
    {
      label: "Platform matrix",
      status: defaultMatrix ? "review" : "ready",
      detail: defaultMatrix
        ? "Default macOS/Linux/Windows targets are selected. Confirm native dependencies before publish."
        : input.preview.hostTargets.join(", "),
    },
    {
      label: "Environment needs",
      status: input.preview.environment.length > 0 ? "ready" : "review",
      detail:
        input.preview.environment.length > 0
          ? input.preview.environment.join(", ")
          : "No environment signals detected beyond package metadata.",
    },
    {
      label: "Security review",
      status: "pending",
      detail:
        "Static, malware, and policy checks run in the background after the Claw Pack is accepted.",
    },
  ] satisfies ClawPackIntakeGate[];
}

function ClawPackIntakeReview({ gates }: { gates: ClawPackIntakeGate[] }) {
  return (
    <Card className="mb-5">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
            Claw Pack checks
          </h2>
          <p className="mt-1 text-sm text-[color:var(--ink-soft)]">
            ClawHub checks the package contract, source provenance, platform coverage, environment
            needs, and background scanning before public install confidence.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {gates.map((gate) => (
            <div
              key={gate.label}
              className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-3"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <strong className="text-sm text-[color:var(--ink)]">{gate.label}</strong>
                <Badge variant={gate.status === "blocked" ? "accent" : "compact"}>
                  {gate.status}
                </Badge>
              </div>
              <p className="m-0 text-sm text-[color:var(--ink-soft)]">{gate.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
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
  const [sourceUrl, setSourceUrl] = useState(
    search.sourceRepo ? `https://github.com/${search.sourceRepo}` : "",
  );
  const [sourceUrlError, setSourceUrlError] = useState<string | null>(null);
  const [sourceUrlStatus, setSourceUrlStatus] = useState<string | null>(null);
  const [sourceUrlBusy, setSourceUrlBusy] = useState(false);
  const [intakeStatus, setIntakeStatus] = useState<string | null>(null);
  const [ignoredPaths, setIgnoredPaths] = useState<string[]>([]);
  const [clawPackImport, setClawPackImport] = useState<ClawPackImportSummary | null>(null);
  const [detectedPrefillFields, setDetectedPrefillFields] = useState<string[]>([]);
  const [codePluginFieldIssues, setCodePluginFieldIssues] = useState<string[]>([]);
  const [codePluginCompatibility, setCodePluginCompatibility] =
    useState<PackageCompatibility | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState<PublishSuccess | null>(null);

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
  const clawPackPreview = useMemo(
    () =>
      buildClawPackPreview({
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
  const publishLifecycle = useMemo(() => {
    if (status) return { label: status };
    if (!files.length) return { label: "Waiting for files" };
    if (clawPackPreview?.blockers.length) return { label: "Needs details" };
    return { label: "Ready to publish" };
  }, [files.length, clawPackPreview, status]);

  const onPickFiles = async (selected: File[]) => {
    try {
      setIntakeStatus("Reading package files...");
      const expanded = await expandFilesWithReport(selected, {
        includeBinaryArchiveFiles: true,
      });
      setIntakeStatus("Filtering local-only files...");
      const filtered = await filterIgnoredPackageFiles(expanded.files);
      setIntakeStatus("Looking for Claw Pack metadata...");
      const imported = await normalizeClawPackImport(filtered.files);
      const selectedFiles = imported.summary ? imported.files : filtered.files;
      const normalized = normalizePackageUploadFiles(selectedFiles);
      const nextIgnoredPaths = [
        ...new Set([...expanded.ignoredMacJunkPaths, ...filtered.ignoredPaths]),
      ];
      setFiles(selectedFiles);
      setPublishSuccess(null);
      setIgnoredPaths(nextIgnoredPaths);
      setClawPackImport(imported.summary);
      setError(null);
      setIntakeStatus("Prefilling package details...");
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
      setIntakeStatus("Package ready for review.");
    } catch (pickError) {
      setFiles([]);
      setPublishSuccess(null);
      setIgnoredPaths([]);
      setClawPackImport(null);
      setDetectedPrefillFields([]);
      setCodePluginFieldIssues([]);
      setCodePluginCompatibility(null);
      setIntakeStatus(null);
      setError(formatPublishError(pickError));
    }
  };

  const onApplySourceUrl = async () => {
    if (!sourceUrl.trim()) {
      setSourceUrlError("Paste a GitHub repo, tree, or blob URL.");
      return;
    }
    try {
      setSourceUrlBusy(true);
      setSourceUrlError(null);
      setSourceUrlStatus("Resolving GitHub URL...");
      const imported = await fetchGitHubPackageSource(sourceUrl, {
        maxFileBytes: MAX_PUBLISH_FILE_BYTES,
        maxTotalBytes: MAX_PUBLISH_TOTAL_BYTES,
        onProgress: (progress) => setSourceUrlStatus(formatGitHubSourceProgress(progress)),
      });
      setSourceUrlStatus(`Preparing ${imported.files.length} GitHub files for review...`);
      await onPickFiles(imported.files);
      setSourceRepo(imported.source.repo);
      setSourceCommit(imported.source.commit);
      setSourceRef(imported.source.ref);
      setSourcePath(imported.source.path);
      setSourceUrl(imported.source.url);
      setSourceUrlStatus(`Fetched ${imported.files.length} files from ${imported.source.repo}.`);
      setIntakeStatus("GitHub package ready for review.");
      toast.success("GitHub package fetched. Review the inferred details.");
    } catch (sourceError) {
      setSourceUrlStatus(null);
      setSourceUrlError(formatPublishError(sourceError));
    } finally {
      setSourceUrlBusy(false);
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
            Plugin onboarding now builds a Claw Pack (npm pack compatible) from your files. Upload a
            package or paste a GitHub URL, review the inferred details, then publish.
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

        <div className="mb-5 grid gap-3 rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-4 text-sm md:grid-cols-3">
          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-soft)]">
              1. Intake
            </span>
            <strong className="text-[color:var(--ink)]">
              {files.length ? `${files.length} files received` : "Choose files or source"}
            </strong>
          </div>
          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-soft)]">
              2. Details
            </span>
            <strong className="text-[color:var(--ink)]">
              {files.length && !clawPackPreview?.blockers.length ? "Ready" : "Needs review"}
            </strong>
          </div>
          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-soft)]">
              3. Publish
            </span>
            <strong className="text-[color:var(--ink)]">{publishLifecycle.label}</strong>
          </div>
        </div>

        <PackageSourceChooser
          files={files}
          totalBytes={totalBytes}
          normalizedPaths={normalizedPaths}
          normalizedPathSet={normalizedPathSet}
          ignoredPaths={ignoredPaths}
          sourceUrl={sourceUrl}
          sourceUrlError={sourceUrlError}
          sourceUrlStatus={sourceUrlStatus}
          sourceUrlBusy={sourceUrlBusy}
          intakeStatus={intakeStatus}
          detectedPrefillFields={detectedPrefillFields}
          family={family}
          validationError={validationError}
          codePluginFieldIssues={codePluginFieldIssues}
          codePluginCompatibility={codePluginCompatibility}
          clawPackImport={clawPackImport}
          hostTargets={hostTargets}
          onSourceUrlChange={setSourceUrl}
          onApplySourceUrl={onApplySourceUrl}
          onPickFiles={onPickFiles}
        />

        {clawPackPreview ? (
          <ClawPackIntakeReview
            gates={buildClawPackIntakeGates({
              preview: clawPackPreview,
              family,
              sourceRepo,
              sourceCommit,
              sourceRef,
            })}
          />
        ) : null}

        {clawPackPreview ? (
          <Card className="mb-5">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
                    Claw Pack preview
                  </h2>
                  <p className="mt-1 text-sm text-[color:var(--ink-soft)]">
                    This is the generated package contract ClawHub will build on publish.
                  </p>
                </div>
                <InstallCopyButton
                  text={clawPackPreview.manifestJson}
                  ariaLabel="Copy Claw Pack preview manifest"
                />
              </div>

              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] p-3">
                  <dt className="mb-1 text-[color:var(--ink-soft)]">Final archive</dt>
                  <dd className="font-semibold text-[color:var(--ink)]">
                    {clawPackPreview.finalFileCount} files including CLAWPACK.json
                  </dd>
                </div>
                <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] p-3">
                  <dt className="mb-1 text-[color:var(--ink-soft)]">Selected size</dt>
                  <dd className="font-semibold text-[color:var(--ink)]">
                    {formatPreviewBytes(clawPackPreview.selectedBytes)}
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
                {clawPackPreview.hostTargets.map((target) => (
                  <Badge key={target} variant="compact">
                    {target}
                  </Badge>
                ))}
                {clawPackPreview.environment.map((signal) => (
                  <Badge key={signal} variant="compact">
                    {signal}
                  </Badge>
                ))}
              </div>

              {clawPackPreview.blockers.length > 0 ? (
                <div className="rounded-[var(--radius-sm)] border border-red-300/50 bg-red-50 p-3 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-100">
                  <strong>Blocking issues</strong>
                  <ul className="mt-2 list-disc pl-5">
                    {clawPackPreview.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {clawPackPreview.warnings.length > 0 ? (
                <div className="rounded-[var(--radius-sm)] border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
                  <strong>Warnings</strong>
                  <ul className="mt-2 list-disc pl-5">
                    {clawPackPreview.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <strong className="text-sm text-[color:var(--ink)]">CLAWPACK.json</strong>
                  <span className="text-xs text-[color:var(--ink-soft)]">
                    digests computed after upload
                  </span>
                </div>
                <pre className="max-h-[420px] overflow-auto rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-4 text-xs leading-5 text-[color:var(--ink)]">
                  <code>{clawPackPreview.manifestJson}</code>
                </pre>
              </div>
            </div>
          </Card>
        ) : null}

        {publishSuccess ? (
          <Card className="mb-5 border-emerald-300/50 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-950/30">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <Badge variant="compact">Published</Badge>
                <h2 className="mt-2 mb-1 font-display text-xl font-bold text-[color:var(--ink)]">
                  {publishSuccess.name}@{publishSuccess.version}
                </h2>
                <p className="m-0 text-sm text-[color:var(--ink-soft)]">
                  The Claw Pack was accepted and stored. Public plugin pages are unchanged while
                  review, scanning, and rollout controls stay behind management surfaces.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="primary" size="sm">
                  <a href="/dashboard">Open dashboard</a>
                </Button>
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
                      const publishName = name.trim();
                      const publishVersion = version.trim();
                      setStatus("Uploading files...");
                      setError(null);
                      setPublishSuccess(null);
                      const uploaded = await buildPackageUploadEntries(files, {
                        generateUploadUrl,
                        hashFile,
                        uploadFile,
                        onProgress: (progress) => {
                          setStatus(
                            `Uploading file ${progress.current}/${progress.total}: ${progress.path}`,
                          );
                        },
                      });
                      setStatus("Publishing release...");
                      const result = await publishRelease({
                        payload: {
                          name: publishName,
                          displayName: displayName.trim() || undefined,
                          ownerHandle: ownerHandle || undefined,
                          family,
                          version: publishVersion,
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
                      setPublishSuccess({
                        name: publishName,
                        version: publishVersion,
                        releaseId:
                          typeof result === "object" &&
                          result !== null &&
                          "releaseId" in result &&
                          typeof result.releaseId === "string"
                            ? result.releaseId
                            : undefined,
                      });
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
