import { createFileRoute, useSearch } from "@tanstack/react-router";
import type { PackageCompatibility } from "clawhub-schema";
import { useAction, useMutation, useQuery } from "convex/react";
import { startTransition, useEffect, useMemo, useState } from "react";
import semver from "semver";
import { api } from "../../convex/_generated/api";
import { PackageSourceChooser } from "../components/PackageSourceChooser";
import {
  MAX_PUBLISH_FILE_BYTES,
  MAX_PUBLISH_TOTAL_BYTES,
} from "../../convex/lib/publishLimits";
import {
  buildPackageUploadEntries,
  filterIgnoredPackageFiles,
  normalizePackageUploadFiles,
} from "../lib/packageUpload";
import {
  derivePluginPrefill,
  listPrefilledFields,
} from "../lib/pluginPublishPrefill";
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
  const [codePluginFieldIssues, setCodePluginFieldIssues] = useState<string[]>([]);
  const [codePluginCompatibility, setCodePluginCompatibility] = useState<PackageCompatibility | null>(
    null,
  );
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
    setCodePluginFieldIssues(prefill.missingRequiredFields ?? []);
    setCodePluginCompatibility(prefill.compatibility ?? null);
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
        onPickFiles={onPickFiles}
      />

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
            (family === "code-plugin" &&
              (!sourceRepo.trim() || !sourceCommit.trim() || codePluginFieldIssues.length > 0))
          }
          onClick={() => {
            startTransition(() => {
              void (async () => {
                try {
                  if (validationError) {
                    setError(validationError);
                    return;
                  }
                  if (family === "code-plugin" && codePluginFieldIssues.length > 0) {
                    setError(
                      `Missing required OpenClaw package metadata: ${codePluginFieldIssues.join(", ")}`,
                    );
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
