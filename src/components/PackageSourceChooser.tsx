import type { PackageCompatibility } from "clawhub-schema";
import { Package } from "lucide-react";
import { useRef, useState } from "react";
import { formatPackageCompatibility } from "../lib/pluginPublishPrefill";
import { expandDroppedItems } from "../lib/uploadFiles";
import { formatBytes } from "../routes/upload/-utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

export function PackageSourceChooser(props: {
  files: File[];
  totalBytes: number;
  normalizedPaths: string[];
  normalizedPathSet: Set<string>;
  ignoredPaths: string[];
  detectedPrefillFields: string[];
  family: "code-plugin" | "bundle-plugin";
  validationError: string | null;
  codePluginFieldIssues: string[];
  codePluginCompatibility: PackageCompatibility | null;
  onPickFiles: (selected: File[]) => Promise<void>;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const isMetadataLocked = props.files.length === 0 || Boolean(props.validationError);

  const setDirectoryInputRef = (node: HTMLInputElement | null) => {
    directoryInputRef.current = node;
    if (node) {
      node.setAttribute("webkitdirectory", "");
      node.setAttribute("directory", "");
    }
  };

  return (
    <Card className="mb-5">
      <input
        ref={archiveInputRef}
        className="hidden"
        type="file"
        multiple
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
            Drag a folder, zip, or tgz here. We inspect the package to unlock and prefill the rest
            of the form.
          </span>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => archiveInputRef.current?.click()}>
              Browse files
            </Button>
            <Button variant="ghost" size="sm" onClick={() => directoryInputRef.current?.click()}>
              Choose folder
            </Button>
          </div>
        </div>
      </div>

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
            </div>
          </>
        )}
      </div>
      {props.validationError ? <Badge variant="accent">{props.validationError}</Badge> : null}
      {props.family === "code-plugin" && props.codePluginFieldIssues.length > 0 ? (
        <Badge variant="accent">
          Missing required OpenClaw package metadata: {props.codePluginFieldIssues.join(", ")}. Add
          these fields to <code>package.json</code> before publishing. See{" "}
          <a href="/plugins/sdk-setup#package-metadata" className="underline">
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
    </Card>
  );
}
