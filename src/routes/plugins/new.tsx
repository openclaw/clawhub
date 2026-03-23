import { createFileRoute } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { startTransition, useEffect, useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import {
  MAX_PUBLISH_FILE_BYTES,
  MAX_PUBLISH_TOTAL_BYTES,
} from "../../../convex/lib/publishLimits";
import { expandDroppedItems, expandFilesWithReport } from "../../lib/uploadFiles";
import { buildPackageUploadEntries, filterIgnoredPackageFiles } from "../../lib/packageUpload";
import { useAuthStatus } from "../../lib/useAuthStatus";
import { formatBytes, formatPublishError, hashFile, uploadFile } from "../upload/-utils";

export const Route = createFileRoute("/plugins/new")({
  component: PublishPluginRoute,
});

const apiRefs = api as unknown as {
  packages: {
    publishRelease: unknown;
  };
};

function PublishPluginRoute() {
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
  const [family, setFamily] = useState<"code-plugin" | "bundle-plugin">("code-plugin");
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [ownerHandle, setOwnerHandle] = useState("");
  const [version, setVersion] = useState("0.1.0");
  const [changelog, setChangelog] = useState("");
  const [sourceRepo, setSourceRepo] = useState("");
  const [sourceCommit, setSourceCommit] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [sourcePath, setSourcePath] = useState(".");
  const [bundleFormat, setBundleFormat] = useState("");
  const [hostTargets, setHostTargets] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [ignoredPaths, setIgnoredPaths] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
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

  const onPickFiles = async (selected: File[]) => {
    const expanded = await expandFilesWithReport(selected, {
      includeBinaryArchiveFiles: true,
    });
    const filtered = await filterIgnoredPackageFiles(expanded.files);
    const nextIgnoredPaths = [...new Set([...expanded.ignoredMacJunkPaths, ...filtered.ignoredPaths])];
    setFiles(filtered.files);
    setIgnoredPaths(nextIgnoredPaths);
    setError(null);

    const packageJson = filtered.files.find((file) => file.name.toLowerCase().endsWith("package.json"));
    if (!packageJson) return;
    try {
      const text = await packageJson.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.name === "string") setName(parsed.name);
      if (typeof parsed.displayName === "string") setDisplayName(parsed.displayName);
      if (typeof parsed.version === "string") setVersion(parsed.version);
    } catch {
      // ignore invalid package.json during form-prefill
    }
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
          Publish Plugin
        </h1>
        <p className="section-subtitle" style={{ marginBottom: 0 }}>
          Upload a native code plugin or bundle plugin release.
        </p>
        <p className="section-subtitle" style={{ marginBottom: 0 }}>
          New releases stay private until automated security checks and verification finish.
        </p>
      </header>
      <div className="card" style={{ display: "grid", gap: 12 }}>
        {!isAuthenticated ? <div>Log in to publish plugins.</div> : null}
        <select className="input" value={family} onChange={(event) => setFamily(event.target.value as never)}>
          <option value="code-plugin">Code plugin</option>
          <option value="bundle-plugin">Bundle plugin</option>
        </select>
        <input className="input" placeholder="Plugin name" value={name} onChange={(event) => setName(event.target.value)} />
        <input
          className="input"
          placeholder="Display name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <select className="input" value={ownerHandle} onChange={(event) => setOwnerHandle(event.target.value)}>
          {(publishers ?? []).map((entry) => (
            <option key={entry.publisher._id} value={entry.publisher.handle}>
              @{entry.publisher.handle} · {entry.publisher.displayName}
            </option>
          ))}
        </select>
        <input className="input" placeholder="Version" value={version} onChange={(event) => setVersion(event.target.value)} />
        <textarea
          className="input"
          placeholder="Changelog"
          rows={4}
          value={changelog}
          onChange={(event) => setChangelog(event.target.value)}
        />
        <input
          className="input"
          placeholder="Source repo (owner/repo)"
          value={sourceRepo}
          onChange={(event) => setSourceRepo(event.target.value)}
        />
        <input
          className="input"
          placeholder="Source commit"
          value={sourceCommit}
          onChange={(event) => setSourceCommit(event.target.value)}
        />
        <input
          className="input"
          placeholder="Source ref (tag or branch)"
          value={sourceRef}
          onChange={(event) => setSourceRef(event.target.value)}
        />
        <input
          className="input"
          placeholder="Source path"
          value={sourcePath}
          onChange={(event) => setSourcePath(event.target.value)}
        />
        {family === "bundle-plugin" ? (
          <>
            <input
              className="input"
              placeholder="Bundle format"
              value={bundleFormat}
              onChange={(event) => setBundleFormat(event.target.value)}
            />
            <input
              className="input"
              placeholder="Host targets (comma separated)"
              value={hostTargets}
              onChange={(event) => setHostTargets(event.target.value)}
            />
          </>
        ) : null}
        <input
          className="input"
          type="file"
          multiple
          // @ts-expect-error non-standard directory picker
          webkitdirectory=""
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            void onPickFiles(selected);
          }}
        />
        <div className="tag">{files.length} files · {formatBytes(totalBytes)}</div>
        {ignoredPaths.length > 0 ? <div className="tag">Ignored {ignoredPaths.length} files via ignore rules.</div> : null}
        {validationError ? <div className="tag tag-accent">{validationError}</div> : null}
        <button
          className="btn"
          type="button"
          disabled={
            !isAuthenticated ||
            !name.trim() ||
            !version.trim() ||
            files.length === 0 ||
            Boolean(validationError) ||
            Boolean(status) ||
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
      <div
        className="card"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void (async () => {
            const dropped = await expandDroppedItems(event.dataTransfer.items);
            await onPickFiles(dropped);
          })();
        }}
      >
        Drop a plugin folder, zip, or tgz here.
      </div>
    </main>
  );
}
