import { useAuthToken } from "@convex-dev/auth/react";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { ApiRoutes, DocsLinks, getPackageScopeOwnerMismatch } from "clawhub-schema";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, Info, Lock } from "lucide-react";
import { type ReactNode, startTransition, useEffect, useMemo, useState } from "react";
import semver from "semver";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import {
  getPackageMultipartSizeError,
  isPackageMultipartUploadTooLarge,
  MAX_CLAWPACK_BYTES,
  MAX_PACKAGE_MULTIPART_BYTES,
  MAX_PUBLISH_FILE_BYTES,
} from "../../../convex/lib/publishLimits";
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
import { packageApiWriteUrl } from "../../lib/packageApi";
import {
  appendPackageUploadFiles,
  filterIgnoredPackageFiles,
  normalizePackageUploadFiles,
} from "../../lib/packageUpload";
import { derivePluginPrefill, listPrefilledFields } from "../../lib/pluginPublishPrefill";
import { expandFilesWithReport, isNpmPackTarball } from "../../lib/uploadFiles";
import { useAuthStatus } from "../../lib/useAuthStatus";
import { formatPublishError, uploadFile } from "../upload/-utils";

export const Route = createFileRoute("/plugins/publish")({
  validateSearch: (search) => ({
    ownerHandle: typeof search.ownerHandle === "string" ? search.ownerHandle : undefined,
    name: typeof search.name === "string" ? search.name : undefined,
    displayName: typeof search.displayName === "string" ? search.displayName : undefined,
    family: search.family === "code-plugin" ? search.family : undefined,
    nextVersion: typeof search.nextVersion === "string" ? search.nextVersion : undefined,
    sourceRepo: typeof search.sourceRepo === "string" ? search.sourceRepo : undefined,
  }),
  component: PublishPluginRoute,
});

type PluginPublishFamily = "code-plugin" | "bundle-plugin";

const PLUGIN_PUBLISHING_GUIDE_URL = "https://docs.openclaw.ai/clawhub/publishing#plugins";

async function getSelectedTarball(selected: File[]) {
  if (selected.length !== 1) return null;
  const [file] = selected;
  if (!file) return null;
  return (await isNpmPackTarball(file)) ? file : null;
}

export function PublishPluginRoute() {
  const search = useSearch({ from: "/plugins/publish" });
  const { isAuthenticated, isLoading: isAuthLoading, me } = useAuthStatus();
  const authToken = useAuthToken();
  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const publishers = useQuery(api.publishers.listMine, me ? {} : "skip") as
    | Array<PublisherOwnerMembership>
    | undefined;
  const [family, setFamily] = useState<PluginPublishFamily>("code-plugin");
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
  const [packageSourceKind, setPackageSourceKind] = useState<PackagePickSource | null>(null);
  const [publishTarball, setPublishTarball] = useState<File | null>(null);
  const [ignoredPaths, setIgnoredPaths] = useState<string[]>([]);
  const [detectedPrefillFields, setDetectedPrefillFields] = useState<string[]>([]);
  const [codePluginFieldIssues, setCodePluginFieldIssues] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showChangelogField = Boolean(search.name);

  const totalBytes = useMemo(
    () => publishTarball?.size ?? files.reduce((sum, file) => sum + file.size, 0),
    [files, publishTarball],
  );
  const normalizedPaths = useMemo(
    () => normalizePackageUploadFiles(files).map((entry) => entry.path),
    [files],
  );
  const normalizedPathSet = useMemo(
    () => new Set(normalizedPaths.map((path) => path.toLowerCase())),
    [normalizedPaths],
  );
  const oversizedFiles = useMemo(
    () => (publishTarball ? [] : files.filter((file) => file.size > MAX_PUBLISH_FILE_BYTES)),
    [files, publishTarball],
  );
  const oversizedFileNames = useMemo(
    () => oversizedFiles.slice(0, 3).map((file) => file.name),
    [oversizedFiles],
  );
  const validationError =
    oversizedFiles.length > 0
      ? `Each file must be 10MB or smaller: ${oversizedFileNames.join(", ")}`
      : publishTarball && totalBytes > MAX_CLAWPACK_BYTES
        ? "ClawPack exceeds 120MB limit."
        : !publishTarball && totalBytes > MAX_PACKAGE_MULTIPART_BYTES
          ? "Total file size exceeds 18MB for package uploads."
          : null;
  const isMetadataLocked = files.length === 0;
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
  const hasPublished = status?.startsWith("Published.") ?? false;
  const isPublishDisabled =
    !isAuthenticated ||
    !authToken ||
    isMetadataLocked ||
    hasPackageBlocker ||
    submitBlockers.length > 0 ||
    isSubmitting ||
    hasPublished;
  const publishBlockerSummary = useMemo(() => {
    if (isSubmitting) return null;
    if (!isAuthenticated || !authToken) return "Sign in to publish.";
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
    authToken,
    isAuthenticated,
    isMetadataLocked,
    isSubmitting,
    ownerScopeError,
    submitBlockers,
    validationError,
  ]);

  const onPickFiles = async (selected: File[], sourceKind: PackagePickSource) => {
    const selectedTarball = await getSelectedTarball(selected);
    const expanded = await expandFilesWithReport(selected, {
      includeBinaryArchiveFiles: true,
    });
    const uploadFiles = selectedTarball
      ? { files: expanded.files, ignoredPaths: [] }
      : await filterIgnoredPackageFiles(expanded.files);
    const normalized = normalizePackageUploadFiles(uploadFiles.files);
    const nextIgnoredPaths = [
      ...new Set([...expanded.ignoredLocalMetadataPaths, ...uploadFiles.ignoredPaths]),
    ];
    setFiles(uploadFiles.files);
    setPublishTarball(selectedTarball);
    setPackageSourceKind(sourceKind);
    setIgnoredPaths(nextIgnoredPaths);
    setError(null);
    setStatus(null);
    const prefill = await derivePluginPrefill(normalized);
    setDetectedPrefillFields(listPrefilledFields(prefill));
    setCodePluginFieldIssues(prefill.missingRequiredFields ?? []);
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
    setPublishTarball(null);
    setPackageSourceKind(null);
    setIgnoredPaths([]);
    setDetectedPrefillFields([]);
    setCodePluginFieldIssues([]);
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
    <main className="py-10">
      <Container size="narrow">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="mb-2 font-display text-2xl font-bold text-[color:var(--ink)]">
              {search.name ? "Publish Plugin Release" : "Publish Plugin"}
            </h1>
            <p className="text-sm text-[color:var(--ink-soft)]">
              Drop or select a plugin folder, .zip, or .tgz
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
          <Button asChild variant="outline" size="sm" className="w-fit">
            <a href={PLUGIN_PUBLISHING_GUIDE_URL} target="_blank" rel="noreferrer">
              Plugin publishing guide
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </Button>
        </header>

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
        />

        <div
          className={
            isMetadataLocked
              ? "relative max-h-[540px] overflow-hidden md:max-h-[600px]"
              : "contents"
          }
        >
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
                  <Label htmlFor="pluginOwner">Owner</Label>
                  <PublisherOwnerSelect
                    id="pluginOwner"
                    value={ownerHandle}
                    memberships={publishers}
                    disabled={metadataDisabled}
                    onValueChange={setOwnerHandle}
                  />
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
              {error ? (
                <div className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
                  {error}
                </div>
              ) : null}
              {status ? <div className="text-sm text-[color:var(--ink-soft)]">{status}</div> : null}
              {!status ? (
                <div className="text-sm text-[color:var(--ink-soft)]">
                  New releases stay private until automated security checks and verification finish.
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
                      const payload = {
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
                      };
                      const payloadJson = JSON.stringify(payload);
                      const tarballUploadTooLarge = publishTarball
                        ? isPackageMultipartUploadTooLarge({
                            payloadJson,
                            fileFieldName: "clawpack",
                            files: [
                              {
                                name: publishTarball.name,
                                size: publishTarball.size,
                                type: publishTarball.type,
                              },
                            ],
                          })
                        : false;
                      const fileUploadTooLarge =
                        !publishTarball &&
                        isPackageMultipartUploadTooLarge({
                          payloadJson,
                          fileFieldName: "files",
                          files: normalizePackageUploadFiles(files).map(({ file, path }) => ({
                            name: path,
                            size: file.size,
                            type: file.type,
                          })),
                        });
                      if (fileUploadTooLarge) {
                        toast.error(getPackageMultipartSizeError());
                        return;
                      }
                      setIsSubmitting(true);
                      setStatus("Publishing release...");
                      setError(null);
                      const form = new FormData();
                      form.set("payload", payloadJson);
                      if (publishTarball) {
                        if (tarballUploadTooLarge) {
                          setStatus("Uploading package artifact...");
                          const uploadUrl = await generateUploadUrl();
                          const storageId = await uploadFile(uploadUrl, publishTarball);
                          form.set("clawpack", storageId);
                        } else {
                          form.set("clawpack", publishTarball, publishTarball.name);
                        }
                      } else {
                        appendPackageUploadFiles(form, files);
                      }
                      const response = await fetch(packageApiWriteUrl(ApiRoutes.packages), {
                        method: "POST",
                        headers: { Authorization: `Bearer ${authToken}` },
                        body: form,
                      });
                      if (!response.ok) {
                        throw new Error(await response.text());
                      }
                      setStatus(
                        "Published. Pending security checks and verification before public listing.",
                      );
                    } catch (publishError) {
                      setError(formatPublishError(publishError));
                      toast.error(formatPublishError(publishError));
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

          {isMetadataLocked ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-44"
              style={{
                background: "linear-gradient(to bottom, transparent, var(--bg) 88%)",
              }}
            />
          ) : null}
        </div>
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
