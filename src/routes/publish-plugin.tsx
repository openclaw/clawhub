import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Package, X } from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import semver from "semver";
import { api } from "../../convex/_generated/api";
import {
  MAX_PUBLISH_FILE_BYTES,
  MAX_PUBLISH_TOTAL_BYTES,
} from "../../convex/lib/publishLimits";
import {
  buildPackageUploadEntries,
  filterIgnoredPackageFiles,
  normalizePackageUploadFiles,
} from "../lib/packageUpload";
import { expandDroppedItems, expandFilesWithReport } from "../lib/uploadFiles";
import { useAuthStatus } from "../lib/useAuthStatus";
import {
  PACKAGE_NAME_PATTERN,
  type JsonRecord,
  type PluginPublishPrefill,
  extractSourceRepo,
  getString,
  getStringList,
  isRecord,
  normalizeGitHubRepo,
} from "../lib/pluginPublish";
import { formatBytes, formatPublishError, hashFile, uploadFile } from "./upload/-utils";

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
    generateChangelogPreview: unknown;
  };
};

function OptionalTag() {
  return (
    <span
      style={{
        fontWeight: 400,
        textTransform: "none",
        letterSpacing: 0,
        opacity: 0.6,
        marginLeft: 6,
      }}
    >
      (optional)
    </span>
  );
}

function SectionDivider({ title, hint }: { title: string; hint?: string }) {
  return (
    <div
      style={{
        borderTop: "1px solid rgba(255,118,84,0.16)",
        marginTop: 4,
        paddingTop: 16,
      }}
    >
      <h2 className="upload-panel-title">{title}</h2>
      {hint ? (
        <p style={{ margin: "2px 0 0", fontSize: "0.85rem", color: "var(--ink-soft)" }}>{hint}</p>
      ) : null}
    </div>
  );
}

function PublishPluginRoute() {
  const search = useSearch({ from: "/publish-plugin" });
  const navigate = useNavigate();
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
  const publishRelease = useAction(apiRefs.packages.publishRelease as never) as unknown as (
    args: { payload: unknown },
  ) => Promise<unknown>;
  const generateChangelogPreview = useAction(
    apiRefs.packages.generateChangelogPreview as never,
  ) as unknown as (args: {
    name: string;
    version: string;
    readmeText: string;
    filePaths?: string[];
  }) => Promise<{ changelog: string; source: "auto" }>;

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
  const [detectedPrefillFields, setDetectedPrefillFields] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [changelogSource, setChangelogSource] = useState<"auto" | "user" | null>(null);
  const [changelogStatus, setChangelogStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const changelogTouchedRef = useRef(false);
  const changelogRequestRef = useRef(0);

  const invalidateAutoChangelog = () => {
    changelogRequestRef.current += 1;
  };

  // webkitdirectory/directory attributes are set via the ref callback to ensure
  // they persist across hydration and re-renders
  const setDirectoryInputRef = (node: HTMLInputElement | null) => {
    directoryInputRef.current = node;
    if (node) {
      node.setAttribute("webkitdirectory", "");
      node.setAttribute("directory", "");
    }
  };

  const totalBytes = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);
  const normalizedFiles = useMemo(() => normalizePackageUploadFiles(files), [files]);
  const normalizedPaths = useMemo(
    () => normalizedFiles.map((entry) => entry.path),
    [normalizedFiles],
  );
  const normalizedPathSet = useMemo(
    () => new Set(normalizedPaths.map((path) => path.toLowerCase())),
    [normalizedPaths],
  );
  const oversizedFiles = useMemo(
    () => files.filter((f) => f.size > MAX_PUBLISH_FILE_BYTES),
    [files],
  );
  const oversizedFileNames = useMemo(
    () => oversizedFiles.slice(0, 3).map((f) => f.name),
    [oversizedFiles],
  );
  const isSubmitting = status !== null;

  const validation = useMemo(() => {
    const issues: string[] = [];
    const trimmedName = name.trim();
    const trimmedVersion = version.trim();

    if (!trimmedName) {
      issues.push("Plugin name is required.");
    } else if (!PACKAGE_NAME_PATTERN.test(trimmedName)) {
      issues.push("Plugin name must be npm-safe (e.g. @scope/name or plugin-name).");
    }
    if (!trimmedVersion) {
      issues.push("Version is required.");
    } else if (!semver.valid(trimmedVersion)) {
      issues.push("Version must be valid semver (e.g. 1.0.0 or 2026.3.23).");
    }
    if (family === "code-plugin") {
      if (!sourceRepo.trim()) issues.push("Source repo is required for code plugins.");
      if (!sourceCommit.trim()) issues.push("Source commit hash is required for code plugins.");
    }
    if (
      family === "bundle-plugin" &&
      !hostTargets.trim() &&
      !normalizedPathSet.has("openclaw.bundle.json")
    ) {
      issues.push("Bundle plugins need at least one host target.");
    }
    if (files.length === 0) {
      issues.push("Upload plugin files to continue.");
    } else {
      if (family === "code-plugin") {
        if (!normalizedPathSet.has("package.json")) {
          issues.push("package.json not found in uploaded files.");
        }
        if (!normalizedPathSet.has("openclaw.plugin.json")) {
          issues.push("openclaw.plugin.json not found in uploaded files.");
        }
      }
      if (oversizedFiles.length > 0) {
        issues.push(`Files exceed 10 MB limit: ${oversizedFileNames.join(", ")}.`);
      }
      if (totalBytes > MAX_PUBLISH_TOTAL_BYTES) {
        issues.push("Total upload size exceeds 50 MB.");
      }
    }
    return { issues, ready: issues.length === 0 };
  }, [
    name,
    version,
    family,
    sourceRepo,
    sourceCommit,
    hostTargets,
    files.length,
    normalizedPathSet,
    oversizedFiles.length,
    oversizedFileNames,
    totalBytes,
  ]);

  const syncDerivedStateFromFiles = async (
    nextFiles: File[],
    options: { applyPrefillFields: boolean },
  ) => {
    const normalized = normalizePackageUploadFiles(nextFiles);
    const prefill = await derivePluginPrefill(normalized);
    setDetectedPrefillFields(listPrefilledFields(prefill));
    if (options.applyPrefillFields) {
      if (prefill.family) setFamily(prefill.family);
      if (prefill.name) setName(prefill.name.toLowerCase());
      if (prefill.displayName) setDisplayName(prefill.displayName);
      if (prefill.version) setVersion(prefill.version);
      if (prefill.sourceRepo) setSourceRepo(prefill.sourceRepo);
      if (prefill.bundleFormat) setBundleFormat(prefill.bundleFormat);
      if (prefill.hostTargets) setHostTargets(prefill.hostTargets);
    }

    if (!changelogTouchedRef.current && prefill.name && prefill.version) {
      const readmeEntry = normalized.find((f) => {
        const lower = f.path.toLowerCase();
        return lower === "readme.md" || lower === "readme.mdx";
      });
      if (readmeEntry) {
        const requestId = ++changelogRequestRef.current;
        setChangelogStatus("loading");
        readmeEntry.file
          .text()
          .then((text) => {
            if (changelogRequestRef.current !== requestId || changelogTouchedRef.current) return null;
            return generateChangelogPreview({
              name: prefill.name!,
              version: prefill.version!,
              readmeText: text.slice(0, 20_000),
              filePaths: normalized.map((f) => f.path),
            });
          })
          .then((result) => {
            if (!result || changelogRequestRef.current !== requestId || changelogTouchedRef.current) return;
            setChangelog(result.changelog);
            setChangelogSource("auto");
            setChangelogStatus("ready");
          })
          .catch(() => {
            if (changelogRequestRef.current !== requestId || changelogTouchedRef.current) return;
            setChangelogStatus("error");
          });
      } else if (changelogSource === "auto") {
        invalidateAutoChangelog();
        setChangelog("");
        setChangelogSource(null);
        setChangelogStatus("idle");
      } else {
        invalidateAutoChangelog();
        setChangelogStatus("idle");
      }
    } else if (!changelogTouchedRef.current && changelogSource === "auto") {
      invalidateAutoChangelog();
      setChangelog("");
      setChangelogSource(null);
      setChangelogStatus("idle");
    } else if (!changelogTouchedRef.current) {
      invalidateAutoChangelog();
      setChangelogStatus("idle");
    }
  };

  const onPickFiles = async (selected: File[]) => {
    const expanded = await expandFilesWithReport(selected, {
      includeBinaryArchiveFiles: true,
    });
    const filtered = await filterIgnoredPackageFiles(expanded.files);
    const nextIgnoredPaths = [...new Set([...expanded.ignoredMacJunkPaths, ...filtered.ignoredPaths])];
    setFiles(filtered.files);
    setIgnoredPaths(nextIgnoredPaths);
    setError(null);
    await syncDerivedStateFromFiles(filtered.files, { applyPrefillFields: true });
  };

  const removeFileAt = (index: number) => {
    const nextFiles = files.filter((_, currentIndex) => currentIndex !== index);
    setFiles(nextFiles);
    setError(null);
    void syncDerivedStateFromFiles(nextFiles, { applyPrefillFields: false });
  };

  useEffect(() => {
    if (ownerHandle) return;
    const personal = publishers?.find((entry) => entry.publisher.kind === "user") ?? publishers?.[0];
    if (personal?.publisher.handle) {
      setOwnerHandle(personal.publisher.handle);
    }
  }, [ownerHandle, publishers]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validation.ready || isSubmitting) return;
    startTransition(() => {
      void (async () => {
        try {
          const normalizedSourceRepo = normalizeGitHubRepo(sourceRepo.trim()) ?? sourceRepo.trim();
          setStatus("Uploading files…");
          setError(null);
          const uploaded = await buildPackageUploadEntries(files, {
            generateUploadUrl,
            hashFile,
            uploadFile,
          });
          setStatus("Publishing release…");
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
                      repo: normalizedSourceRepo,
                      url: sourceRepo.trim().startsWith("http")
                        ? sourceRepo.trim()
                        : `https://github.com/${normalizedSourceRepo.replace(/^\/+|\/+$/g, "")}`,
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
          setStatus(null);
          setError(null);
          void navigate({ to: "/plugins" });
        } catch (publishError) {
          setError(formatPublishError(publishError));
          setStatus(null);
        }
      })();
    });
  }

  if (!isAuthenticated) {
    return (
      <main className="section">
        <div className="card">Sign in to publish a plugin.</div>
      </main>
    );
  }

  return (
    <main className="section upload-page">
      <header className="upload-page-header">
        <div>
          <h1 className="upload-page-title">
            {search.name ? "Publish Plugin Release" : "Publish Plugin"}
          </h1>
          <p className="upload-page-subtitle">
            Publish a code plugin or bundle plugin release. New releases stay private until
            automated security checks complete.
            {search.name
              ? ` Prefilled for ${search.displayName ?? search.name}${search.nextVersion && semver.valid(search.nextVersion) ? ` · suggested ${search.nextVersion}` : ""}.`
              : ""}
          </p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="upload-grid">
        {/* ── LEFT COL ROW 1 — identity + source/bundle ─────────────────── */}
        <div className="card upload-panel" style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <label className="form-label" htmlFor="plugin-family">
            Package type
          </label>
          <select
            className="form-input"
            id="plugin-family"
            value={family}
            onChange={(e) => setFamily(e.target.value as "code-plugin" | "bundle-plugin")}
          >
            <option value="code-plugin">Code plugin</option>
            <option value="bundle-plugin">Bundle plugin</option>
          </select>

          <label className="form-label" htmlFor="plugin-name">
            Plugin name
          </label>
          <input
            className="form-input"
            id="plugin-name"
            placeholder="@scope/plugin-name"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
          />

          <label className="form-label" htmlFor="plugin-display-name">
            Display name <OptionalTag />
          </label>
          <input
            className="form-input"
            id="plugin-display-name"
            placeholder="My Plugin"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />

          <label className="form-label" htmlFor="plugin-owner">
            Owner
          </label>
          <select
            className="form-input"
            id="plugin-owner"
            value={ownerHandle}
            onChange={(e) => setOwnerHandle(e.target.value)}
          >
            {(publishers ?? []).map((entry) => (
              <option key={entry.publisher._id} value={entry.publisher.handle}>
                @{entry.publisher.handle} · {entry.publisher.displayName}
              </option>
            ))}
          </select>

          <label className="form-label" htmlFor="plugin-version">
            Version
          </label>
          <input
            className="form-input"
            id="plugin-version"
            placeholder="1.0.0"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />

          {/* Source section — code-plugin only */}
          {family === "code-plugin" ? (
            <>
              <SectionDivider
                title="Source"
                hint="Code plugins require a verifiable source link for security review."
              />
              <label className="form-label" htmlFor="plugin-source-repo">
                Source repo
              </label>
              <input
                className="form-input"
                id="plugin-source-repo"
                placeholder="owner/repo or GitHub URL"
                value={sourceRepo}
                onChange={(e) => setSourceRepo(e.target.value)}
              />

              <label className="form-label" htmlFor="plugin-source-commit">
                Source commit
              </label>
              <input
                className="form-input"
                id="plugin-source-commit"
                placeholder="Full commit SHA"
                value={sourceCommit}
                onChange={(e) => setSourceCommit(e.target.value)}
              />

              <label className="form-label" htmlFor="plugin-source-ref">
                Source ref <OptionalTag />
              </label>
              <input
                className="form-input"
                id="plugin-source-ref"
                placeholder="Tag or branch name"
                value={sourceRef}
                onChange={(e) => setSourceRef(e.target.value)}
              />

              <label className="form-label" htmlFor="plugin-source-path">
                Source path <OptionalTag />
              </label>
              <input
                className="form-input"
                id="plugin-source-path"
                placeholder="."
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
              />
            </>
          ) : null}

          {/* Bundle section — bundle-plugin only */}
          {family === "bundle-plugin" ? (
            <>
              <SectionDivider title="Bundle" />
              <label className="form-label" htmlFor="plugin-bundle-format">
                Bundle format <OptionalTag />
              </label>
              <input
                className="form-input"
                id="plugin-bundle-format"
                placeholder="e.g. esm, cjs"
                value={bundleFormat}
                onChange={(e) => setBundleFormat(e.target.value)}
              />

              <label className="form-label" htmlFor="plugin-host-targets">
                Host targets
              </label>
              <input
                className="form-input"
                id="plugin-host-targets"
                placeholder="Comma-separated (e.g. cursor, vscode)"
                value={hostTargets}
                onChange={(e) => setHostTargets(e.target.value)}
              />
            </>
          ) : null}
        </div>

        {/* ── RIGHT COL ROW 1 — dropzone + file list ────────────────────── */}
        <div className="card upload-panel">
          <div
            className={`upload-dropzone${isDragging ? " is-dragging" : ""}`}
            role="button"
            tabIndex={0}
            onClick={(event) => {
              const target = event.target as HTMLElement | null;
              if (target?.closest("button")) return;
              if (target instanceof HTMLInputElement) return;
              archiveInputRef.current?.click();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              archiveInputRef.current?.click();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              void (async () => {
                const dropped = event.dataTransfer.items?.length
                  ? await expandDroppedItems(event.dataTransfer.items)
                  : Array.from(event.dataTransfer.files);
                await onPickFiles(dropped);
              })();
            }}
          >
            <input
              ref={archiveInputRef}
              className="upload-file-input"
              type="file"
              multiple
              accept=".zip,.tgz,.tar.gz,application/zip,application/gzip,application/x-gzip,application/x-tar"
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                void onPickFiles(selected);
              }}
            />
            <input
              ref={setDirectoryInputRef}
              className="upload-file-input"
              type="file"
              multiple
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                void onPickFiles(selected);
              }}
            />
            <div className="plugin-dropzone-art" aria-hidden="true">
              <Package size={28} />
            </div>
            <div className="upload-dropzone-copy">
              <div className="upload-dropzone-title-row">
                <strong>Drop plugin folder</strong>
                <span className="upload-dropzone-count">
                  {files.length} files · {formatBytes(totalBytes)}
                </span>
              </div>
              <span className="upload-dropzone-hint">
                Drag a folder, zip, or tgz. We detect the package shape and prefill the form.
              </span>
              {detectedPrefillFields.length > 0 ? (
                <span
                  className="upload-dropzone-hint"
                  style={{ color: "var(--color-success, #1a6b5b)", fontWeight: 600 }}
                >
                  Autofilled: {detectedPrefillFields.join(", ")}.
                </span>
              ) : null}
              <div className="plugin-dropzone-actions">
                <button
                  className="btn upload-picker-btn"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    archiveInputRef.current?.click();
                  }}
                >
                  Browse files
                </button>
                <button
                  className="btn upload-picker-btn plugin-dropzone-secondary"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    directoryInputRef.current?.click();
                  }}
                >
                  Choose folder
                </button>
              </div>
            </div>
          </div>

          {/* File list */}
          <div className="upload-file-list">
            {normalizedFiles.length === 0 ? (
              <div className="stat">No files selected.</div>
            ) : (
              normalizedFiles.map((entry, index) => (
                <div key={`${entry.path}:${index}`} className="upload-file-row">
                  <span className="upload-file-row-label">{entry.path}</span>
                  <button
                    className="upload-file-row-remove"
                    type="button"
                    aria-label={`Remove ${entry.path}`}
                    title={`Remove ${entry.path}`}
                    onClick={() => removeFileAt(index)}
                  >
                    <X size={14} strokeWidth={2.25} aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
            {ignoredPaths.length > 0 ? (
              <div className="stat">
                Ignored {ignoredPaths.length} path{ignoredPaths.length === 1 ? "" : "s"}{" "}
                (node_modules, .git, etc.)
              </div>
            ) : null}
          </div>
        </div>

        {/* ── LEFT COL ROW 2 — validation ───────────────────────────────── */}
        <div className="card upload-panel">
          <h2 className="upload-panel-title">Validation</h2>
          {validation.issues.length === 0 ? (
            <div className="stat">All checks passed.</div>
          ) : (
            <ul className="validation-list">
              {validation.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>

        {/* ── RIGHT COL ROW 2 — changelog ───────────────────────────────── */}
        <div className="card upload-panel">
          <label className="form-label" htmlFor="plugin-changelog">
            Changelog <OptionalTag />
          </label>
          <textarea
            className="form-input"
            id="plugin-changelog"
            rows={6}
            placeholder="Describe what changed in this release…"
            value={changelog}
            onChange={(e) => {
              invalidateAutoChangelog();
              changelogTouchedRef.current = true;
              setChangelogSource("user");
              setChangelogStatus("idle");
              setChangelog(e.target.value);
            }}
            style={{ minHeight: 146, resize: "vertical" }}
          />
          {changelogStatus === "loading" ? <div className="stat">Generating changelog…</div> : null}
          {changelogStatus === "error" ? (
            <div className="stat">Could not auto-generate changelog.</div>
          ) : null}
          {changelogSource === "auto" && changelog ? (
            <div className="stat">Auto-generated changelog (edit as needed).</div>
          ) : null}
        </div>

        {/* ── FULL WIDTH — submit row ────────────────────────────────────── */}
        <div className="upload-submit-row">
          <div className="upload-submit-notes">
            {error ? (
              <div className="error" role="alert">
                {error}
              </div>
            ) : null}
            {status ? <div className="stat">{status}</div> : null}
          </div>
          <button
            className="btn btn-primary upload-submit-btn"
            type="submit"
            disabled={!validation.ready || isSubmitting}
          >
            {isSubmitting ? (status ?? "Publishing…") : "Publish plugin"}
          </button>
        </div>
      </form>
    </main>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────────

async function readJsonUploadFile(
  files: Array<{ file: File; path: string }>,
  expectedPath: string,
): Promise<JsonRecord | null> {
  const normalizedExpectedPath = expectedPath.toLowerCase();
  const expectedFileName = normalizedExpectedPath.split("/").at(-1);
  const entry =
    files.find((file) => file.path.toLowerCase() === normalizedExpectedPath) ??
    files.find((file) => file.path.toLowerCase().endsWith(`/${normalizedExpectedPath}`)) ??
    files.find((file) => {
      const normalizedPath = file.path.toLowerCase();
      return expectedFileName ? normalizedPath.split("/").at(-1) === expectedFileName : false;
    });
  if (!entry) return null;
  try {
    const parsed = JSON.parse((await entry.file.text()).replace(/^\uFEFF/, "")) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function derivePluginPrefill(
  files: Array<{ file: File; path: string }>,
): Promise<PluginPublishPrefill> {
  const packageJson = await readJsonUploadFile(files, "package.json");
  const pluginManifest = await readJsonUploadFile(files, "openclaw.plugin.json");
  const bundleManifest = await readJsonUploadFile(files, "openclaw.bundle.json");
  const openclaw = isRecord(packageJson?.openclaw) ? packageJson.openclaw : undefined;
  const hostTargets = bundleManifest
    ? [...new Set([...getStringList(bundleManifest.hostTargets), ...getStringList(openclaw?.hostTargets)])]
    : [];

  return {
    family: pluginManifest ? "code-plugin" : bundleManifest ? "bundle-plugin" : undefined,
    name: getString(packageJson?.name) ?? getString(pluginManifest?.id) ?? getString(bundleManifest?.id),
    displayName:
      getString(packageJson?.displayName) ??
      getString(pluginManifest?.name) ??
      getString(bundleManifest?.name),
    version: getString(packageJson?.version),
    sourceRepo: extractSourceRepo(packageJson),
    bundleFormat: getString(bundleManifest?.format) ?? getString(openclaw?.bundleFormat),
    hostTargets: hostTargets.length > 0 ? hostTargets.join(", ") : undefined,
  };
}

function listPrefilledFields(prefill: PluginPublishPrefill) {
  const fields: string[] = [];
  if (prefill.family) fields.push("package type");
  if (prefill.name) fields.push("plugin name");
  if (prefill.displayName) fields.push("display name");
  if (prefill.version) fields.push("version");
  if (prefill.sourceRepo) fields.push("source repo");
  if (prefill.bundleFormat) fields.push("bundle format");
  if (prefill.hostTargets) fields.push("host targets");
  return fields;
}

