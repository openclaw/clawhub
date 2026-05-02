import type { PackageCompatibility } from "clawhub-schema";
import { GitBranch, Package, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatPackageCompatibility } from "../lib/pluginPublishPrefill";
import type { ClawPackImportSummary } from "../lib/clawpackImport";
import { expandDroppedItems } from "../lib/uploadFiles";
import { formatBytes } from "../routes/upload/-utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

const OPENCLAW_PLUGIN_PACKAGE_METADATA_DOCS_URL =
  "https://docs.openclaw.ai/plugins/sdk-setup#package-metadata";

export function PackageSourceChooser(props: {
  files: File[];
  totalBytes: number;
  normalizedPaths: string[];
  normalizedPathSet: Set<string>;
  ignoredPaths: string[];
  sourceUrl: string;
  sourceUrlError: string | null;
  intakeStatus: string | null;
  detectedPrefillFields: string[];
  family: "code-plugin" | "bundle-plugin";
  validationError: string | null;
  codePluginFieldIssues: string[];
  codePluginCompatibility: PackageCompatibility | null;
  clawPackImport: ClawPackImportSummary | null;
  hostTargets?: string;
  onSourceUrlChange: (value: string) => void;
  onApplySourceUrl: () => void;
  onPickFiles: (selected: File[]) => Promise<void>;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isClientReady, setIsClientReady] = useState(false);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const isMetadataLocked = props.files.length === 0 || Boolean(props.validationError);
  const hostTargetLabels =
    props.hostTargets
      ?.split(",")
      .map((target) => target.trim())
      .filter(Boolean) ?? [];
  const effectiveHostTargets =
    hostTargetLabels.length > 0
      ? hostTargetLabels
      : ["darwin-arm64", "linux-x64-glibc", "win32-x64"];
  const environmentSignals = deriveEnvironmentSignals(props.normalizedPaths);

  const setDirectoryInputRef = (node: HTMLInputElement | null) => {
    directoryInputRef.current = node;
    if (node) {
      node.setAttribute("webkitdirectory", "");
      node.setAttribute("directory", "");
    }
  };

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  return (
    <Card className="mb-5" data-upload-ready={isClientReady ? "true" : "false"}>
      <input
        ref={archiveInputRef}
        className="hidden"
        type="file"
        multiple
        aria-label="Package archive input"
        accept=".zip,.tgz,.tar.gz,application/zip,application/gzip,application/x-gzip,application/x-tar"
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          void props.onPickFiles(selected);
        }}
      />
      <input
        ref={setDirectoryInputRef}
        className="hidden"
        type="file"
        multiple
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          void props.onPickFiles(selected);
        }}
      />
      <div className="mb-5 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-4">
        <div className="mb-3">
          <h2 className="m-0 font-display text-lg font-bold text-[color:var(--ink)]">
            Plugin onboarding changed
          </h2>
          <p className="m-0 mt-1 text-sm text-[color:var(--ink-soft)]">
            Start with files or a GitHub URL. ClawHub fills what it can and builds the Claw Pack
            when you publish.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
            <div className="mb-3 flex items-center gap-2">
              <UploadCloud size={18} className="text-[color:var(--accent)]" />
              <strong className="text-[color:var(--ink)]">Give us your files</strong>
            </div>
            <p className="m-0 text-sm text-[color:var(--ink-soft)]">
              Drop a folder, zip, tgz, or tarball and we will expand it, ignore local junk, and
              prefill the form.
            </p>
          </div>
          <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] p-4">
            <div className="mb-3 flex items-center gap-2">
              <GitBranch size={18} className="text-[color:var(--accent)]" />
              <strong className="text-[color:var(--ink)]">Paste a GitHub URL</strong>
            </div>
            <div className="flex gap-2">
              <input
                className="min-h-[38px] min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[rgba(29,59,78,0.22)] bg-[rgba(255,255,255,0.94)] px-3 text-sm text-[color:var(--ink)] dark:border-[rgba(255,255,255,0.12)] dark:bg-[rgba(14,28,37,0.84)]"
                value={props.sourceUrl}
                onChange={(event) => props.onSourceUrlChange(event.target.value)}
                placeholder="https://github.com/owner/repo"
                aria-label="GitHub plugin source URL"
              />
              <Button variant="outline" size="sm" onClick={props.onApplySourceUrl}>
                Use URL
              </Button>
            </div>
            {props.sourceUrlError ? (
              <p className="m-0 mt-2 text-xs text-red-700 dark:text-red-200">
                {props.sourceUrlError}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div
        className={`flex flex-col items-center gap-4 rounded-[var(--radius-md)] border-2 border-dashed p-8 text-center transition-colors ${
          isDragging
            ? "border-[color:var(--accent)] bg-[rgba(255,107,74,0.06)]"
            : "border-[color:var(--line)] bg-[color:var(--surface-muted)]"
        }`}
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
            await props.onPickFiles(dropped);
          })();
        }}
      >
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--surface)]"
          aria-hidden="true"
        >
          <Package size={28} className="text-[color:var(--ink-soft)]" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <strong className="text-[color:var(--ink)]">Upload plugin code first</strong>
            <span className="text-xs text-[color:var(--ink-soft)]">
              {props.files.length} files &middot; {formatBytes(props.totalBytes)}
            </span>
          </div>
          <span className="max-w-md text-sm text-[color:var(--ink-soft)]">
            Drag a package archive, folder, zip, or tgz here. ClawHub expands the source package,
            ignores local junk, then generates the Claw Pack itself.
          </span>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!isClientReady}
              onClick={() => archiveInputRef.current?.click()}
            >
              Upload ZIP/TGZ
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!isClientReady}
              onClick={() => directoryInputRef.current?.click()}
            >
              Choose folder
            </Button>
          </div>
          <div className="grid max-w-xl gap-2 pt-2 text-left text-xs text-[color:var(--ink-soft)] sm:grid-cols-2">
            <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] p-3">
            <strong className="block text-[color:var(--ink)]">archive upload</strong>
              <span>.zip, .tgz, and .tar.gz are expanded before publish.</span>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] p-3">
            <strong className="block text-[color:var(--ink)]">folder upload</strong>
              <span>directory picks preserve paths for manifest and package detection.</span>
            </div>
          </div>
        </div>
      </div>

      {props.intakeStatus ? (
        <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--ink)]">
          {props.intakeStatus}
        </div>
      ) : null}

      <div
        className={`rounded-[var(--radius-sm)] border px-4 py-3 transition-colors ${
          isMetadataLocked
            ? "border-[color:var(--line)] bg-[color:var(--surface-muted)]"
            : "border-emerald-300/40 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-950/30"
        }`}
      >
        {props.normalizedPaths.length === 0 ? (
          <div className="text-sm text-[color:var(--ink-soft)]">
            No plugin package selected yet.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <strong className="text-sm text-[color:var(--ink)]">Package detected</strong>
              <span className="text-xs text-[color:var(--ink-soft)]">
                {props.files.length} files &middot; {formatBytes(props.totalBytes)}
              </span>
            </div>
            <p className="mt-1 text-sm text-[color:var(--ink-soft)]">
              {props.detectedPrefillFields.length > 0
                ? `Autofilled ${props.detectedPrefillFields.join(", ")}.`
                : "Package files were detected. Review and fill the release details below."}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {props.normalizedPathSet.has("package.json") ? <Badge>Package manifest</Badge> : null}
              {props.normalizedPathSet.has("openclaw.plugin.json") ? (
                <Badge>Plugin manifest</Badge>
              ) : null}
              {props.normalizedPathSet.has("openclaw.bundle.json") ? (
                <Badge>Bundle manifest</Badge>
              ) : null}
              {props.normalizedPathSet.has("readme.md") ||
              props.normalizedPathSet.has("readme.mdx") ? (
                <Badge>README</Badge>
              ) : null}
              {props.ignoredPaths.length > 0 ? (
                <Badge>Ignored {props.ignoredPaths.length} files</Badge>
              ) : null}
              {props.clawPackImport ? <Badge>Claw Pack import</Badge> : null}
            </div>
          </>
        )}
      </div>
      {props.validationError ? <Badge variant="accent">{props.validationError}</Badge> : null}
      {props.family === "code-plugin" && props.codePluginFieldIssues.length > 0 ? (
        <Badge variant="accent">
          Missing required OpenClaw package metadata: {props.codePluginFieldIssues.join(", ")}. Add
          these fields to <code>package.json</code> before publishing. See{" "}
          <a
            href={OPENCLAW_PLUGIN_PACKAGE_METADATA_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Plugin Setup and Config
          </a>
          .
        </Badge>
      ) : null}
      {props.family === "code-plugin" && props.codePluginCompatibility ? (
        <p className="text-sm text-[color:var(--ink-soft)]">
          Compatibility: {formatPackageCompatibility(props.codePluginCompatibility)}
        </p>
      ) : null}
      {props.normalizedPaths.length > 0 ? (
        <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm text-[color:var(--ink)]">Claw Pack readiness</strong>
            <span className="text-xs text-[color:var(--ink-soft)]">generated on publish</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>Deterministic archive</Badge>
            <Badge>Generated manifest</Badge>
            {effectiveHostTargets.map((target) => (
              <Badge key={target} variant="compact">
                {target}
              </Badge>
            ))}
            {environmentSignals.map((signal) => (
              <Badge key={signal} variant="compact">
                {signal}
              </Badge>
            ))}
          </div>
          <p className="mt-2 text-sm text-[color:var(--ink-soft)]">
            {props.clawPackImport
              ? `Imported ${props.clawPackImport.packageFileCount} package files from a Claw Pack archive. ClawHub will rebuild the canonical manifest and digests on publish.`
              : "ClawHub will package these files with a Claw Pack manifest, host target summary, file digests, and environment hints for OpenClaw clients."}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

function deriveEnvironmentSignals(paths: string[]) {
  const lowerPaths = paths.map((path) => path.toLowerCase());
  const signals = [
    lowerPaths.some((path) => path.includes("playwright") || path.includes("browser"))
      ? "browser"
      : null,
    lowerPaths.some((path) => path.includes("desktop") || path.includes("imessage"))
      ? "desktop"
      : null,
    lowerPaths.some((path) => path.includes("audio") || path.includes("microphone"))
      ? "audio"
      : null,
    "network",
  ].filter((signal): signal is string => Boolean(signal));
  return [...new Set(signals)];
}
