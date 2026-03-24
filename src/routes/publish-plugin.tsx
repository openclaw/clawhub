import { createFileRoute, useSearch } from "@tanstack/react-router";
import { Package } from "lucide-react";
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
  };
};

function PublishPluginRoute() {
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
  const publishRelease = useAction(apiRefs.packages.publishRelease as never) as unknown as (
    args: { payload: unknown },
  ) => Promise<unknown>;
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
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputRef = useRef<HTMLInputElement | null>(null);

  const setDirectoryInputRef = (node: HTMLInputElement | null) => {
    directoryInputRef.current = node;
    if (node) {
      node.setAttribute("webkitdirectory", "");
      node.setAttribute("directory", "");
    }
  };

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

  const onPickFiles = async (selected: File[]) => {
    const expanded = await expandFilesWithReport(selected, {
      includeBinaryArchiveFiles: true,
    });
    const filtered = await filterIgnoredPackageFiles(expanded.files);
    const normalized = normalizePackageUploadFiles(filtered.files);
    const nextIgnoredPaths = [...new Set([...expanded.ignoredMacJunkPaths, ...filtered.ignoredPaths])];
    setFiles(filtered.files);
    setIgnoredPaths(nextIgnoredPaths);
    setError(null);
    const prefill = await derivePluginPrefill(normalized);
    setDetectedPrefillFields(listPrefilledFields(prefill));
    if (prefill.family) setFamily(prefill.family);
    if (prefill.name) setName(prefill.name);
    if (prefill.displayName) setDisplayName(prefill.displayName);
    if (prefill.version) setVersion(prefill.version);
    if (prefill.sourceRepo) setSourceRepo(prefill.sourceRepo);
    if (prefill.bundleFormat) setBundleFormat(prefill.bundleFormat);
    if (prefill.hostTargets) setHostTargets(prefill.hostTargets);
  };

  useEffect(() => {
    if (ownerHandle) return;
    const personal = publishers?.find((entry) => entry.publisher.kind === "user") ?? publishers?.[0];
    if (personal?.publisher.handle) {
      setOwnerHandle(personal.publisher.handle);
    }
  }, [ownerHandle, publishers]);

  return (
    <main className="section">
      <header className="skills-header-top">
        <h1 className="section-title" style={{ marginBottom: 8 }}>
          {search.name ? "Publish Plugin Release" : "Publish Plugin"}
        </h1>
        <p className="section-subtitle" style={{ marginBottom: 0 }}>
          Publish a native code plugin or bundle plugin release.
        </p>
        <p className="section-subtitle" style={{ marginBottom: 0 }}>
          New releases stay private until automated security checks and verification finish.
        </p>
        {search.name ? (
          <p className="section-subtitle" style={{ marginBottom: 0 }}>
            Prefilled for {search.displayName ?? search.name}
            {search.nextVersion && semver.valid(search.nextVersion) ? ` · suggested ${search.nextVersion}` : ""}
          </p>
        ) : null}
      </header>

      <div className="card upload-panel">
        <div
          className={`upload-dropzone${isDragging ? " is-dragging" : ""}`}
          role="button"
          tabIndex={0}
          onClick={(event) => {
            if ((event.target as HTMLElement | null)?.closest("button")) return;
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
              <strong>Upload plugin code first</strong>
              <span className="upload-dropzone-count">
                {files.length} files · {formatBytes(totalBytes)}
              </span>
            </div>
            <span className="upload-dropzone-hint">
              Drag a folder, zip, or tgz here. We inspect the package to unlock and prefill the rest
              of the form.
            </span>
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

        <div className={`plugin-upload-summary${isMetadataLocked ? "" : " is-ready"}`}>
          {normalizedPaths.length === 0 ? (
            <div className="stat">No plugin package selected yet.</div>
          ) : (
            <>
              <div className="plugin-upload-summary-row">
                <strong>Package detected</strong>
                <span className="upload-dropzone-count">
                  {files.length} files · {formatBytes(totalBytes)}
                </span>
              </div>
              <div className="plugin-upload-summary-copy">
                {detectedPrefillFields.length > 0
                  ? `Autofilled ${detectedPrefillFields.join(", ")}.`
                  : "Package files were detected. Review and fill the release details below."}
              </div>
              <div className="plugin-upload-summary-tags">
                {normalizedPathSet.has("package.json") ? <span className="tag">Package manifest</span> : null}
                {normalizedPathSet.has("openclaw.plugin.json") ? (
                  <span className="tag">Plugin manifest</span>
                ) : null}
                {normalizedPathSet.has("openclaw.bundle.json") ? (
                  <span className="tag">Bundle manifest</span>
                ) : null}
                {normalizedPathSet.has("readme.md") || normalizedPathSet.has("readme.mdx") ? (
                  <span className="tag">README</span>
                ) : null}
                {ignoredPaths.length > 0 ? (
                  <span className="tag">Ignored {ignoredPaths.length} files</span>
                ) : null}
              </div>
            </>
          )}
        </div>
        {validationError ? <div className="tag tag-accent">{validationError}</div> : null}
      </div>

      <div
        className={`card plugin-publish-form${isMetadataLocked ? " is-locked" : ""}`}
        style={{ display: "grid", gap: 12 }}
        aria-disabled={isMetadataLocked}
      >
        {!isAuthenticated ? <div>Log in to publish plugins.</div> : null}
        <div className={`plugin-publish-lock-note${isMetadataLocked ? "" : " is-ready"}`}>
          {isMetadataLocked
            ? "Upload plugin code to detect the package shape and unlock the release form."
            : "Metadata detected and prefilled. Review it, then fill any missing release details."}
        </div>
        <select
          className="input"
          value={family}
          disabled={metadataDisabled}
          onChange={(event) => setFamily(event.target.value as never)}
        >
          <option value="code-plugin">Code plugin</option>
          <option value="bundle-plugin">Bundle plugin</option>
        </select>
        <input
          className="input"
          placeholder="Plugin name"
          value={name}
          disabled={metadataDisabled}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="input"
          placeholder="Display name"
          value={displayName}
          disabled={metadataDisabled}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <select
          className="input"
          value={ownerHandle}
          disabled={metadataDisabled}
          onChange={(event) => setOwnerHandle(event.target.value)}
        >
          {(publishers ?? []).map((entry) => (
            <option key={entry.publisher._id} value={entry.publisher.handle}>
              @{entry.publisher.handle} · {entry.publisher.displayName}
            </option>
          ))}
        </select>
        <input
          className="input"
          placeholder="Version"
          value={version}
          disabled={metadataDisabled}
          onChange={(event) => setVersion(event.target.value)}
        />
        <textarea
          className="input"
          placeholder="Changelog"
          rows={4}
          value={changelog}
          disabled={metadataDisabled}
          onChange={(event) => setChangelog(event.target.value)}
        />
        <input
          className="input"
          placeholder="Source repo (owner/repo)"
          value={sourceRepo}
          disabled={metadataDisabled}
          onChange={(event) => setSourceRepo(event.target.value)}
        />
        <input
          className="input"
          placeholder="Source commit"
          value={sourceCommit}
          disabled={metadataDisabled}
          onChange={(event) => setSourceCommit(event.target.value)}
        />
        <input
          className="input"
          placeholder="Source ref (tag or branch)"
          value={sourceRef}
          disabled={metadataDisabled}
          onChange={(event) => setSourceRef(event.target.value)}
        />
        <input
          className="input"
          placeholder="Source path"
          value={sourcePath}
          disabled={metadataDisabled}
          onChange={(event) => setSourcePath(event.target.value)}
        />
        {family === "bundle-plugin" ? (
          <>
            <input
              className="input"
              placeholder="Bundle format"
              value={bundleFormat}
              disabled={metadataDisabled}
              onChange={(event) => setBundleFormat(event.target.value)}
            />
            <input
              className="input"
              placeholder="Host targets (comma separated)"
              value={hostTargets}
              disabled={metadataDisabled}
              onChange={(event) => setHostTargets(event.target.value)}
            />
          </>
        ) : null}
        <button
          className="btn"
          type="button"
          disabled={
            !isAuthenticated ||
            isMetadataLocked ||
            !name.trim() ||
            !version.trim() ||
            files.length === 0 ||
            Boolean(validationError) ||
            isSubmitting ||
            (family === "code-plugin" && (!sourceRepo.trim() || !sourceCommit.trim()))
          }
          onClick={() => {
            startTransition(() => {
              void (async () => {
                try {
                  if (validationError) {
                    setError(validationError);
                    return;
                  }
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
                  setStatus("Published. Pending security checks and verification before public listing.");
                } catch (publishError) {
                  setError(formatPublishError(publishError));
                  setStatus(null);
                }
              })();
            });
          }}
        >
          {status ?? "Publish"}
        </button>
        {error ? <div className="tag tag-accent">{error}</div> : null}
      </div>
    </main>
  );
}

type JsonRecord = Record<string, unknown>;

type PluginPublishPrefill = {
  family?: "code-plugin" | "bundle-plugin";
  name?: string;
  displayName?: string;
  version?: string;
  sourceRepo?: string;
  bundleFormat?: string;
  hostTargets?: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getStringList(value: unknown) {
  if (Array.isArray(value)) return value.map(getString).filter(Boolean) as string[];
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

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

function normalizeGitHubRepo(value: string) {
  const trimmed = value
    .trim()
    .replace(/^git\+/, "")
    .replace(/\.git$/i, "")
    .replace(/^git@github\.com:/i, "https://github.com/");
  if (!trimmed) return undefined;

  const shorthand = trimmed.match(/^([a-z0-9_.-]+)\/([a-z0-9_.-]+)$/i);
  if (shorthand) return `${shorthand[1]}/${shorthand[2]}`;

  try {
    const url = new URL(trimmed);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return undefined;
    const [owner, repo] = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (!owner || !repo) return undefined;
    return `${owner}/${repo}`;
  } catch {
    return undefined;
  }
}

function extractSourceRepo(packageJson: JsonRecord | null) {
  if (!packageJson) return undefined;
  const repository = packageJson.repository;
  if (typeof repository === "string") return normalizeGitHubRepo(repository);
  if (isRecord(repository) && typeof repository.url === "string") {
    return normalizeGitHubRepo(repository.url);
  }
  if (typeof packageJson.homepage === "string") return normalizeGitHubRepo(packageJson.homepage);
  if (isRecord(packageJson.bugs) && typeof packageJson.bugs.url === "string") {
    return normalizeGitHubRepo(packageJson.bugs.url);
  }
  return undefined;
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
