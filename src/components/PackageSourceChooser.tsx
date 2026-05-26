import { DocsLinks } from "clawhub-schema";
import { Package } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { expandDroppedItems } from "../lib/uploadFiles";
import { formatBytes } from "../routes/upload/-utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { UploadDropzoneDecor } from "./UploadDropzoneDecor";

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
  onPickFiles: (selected: File[]) => Promise<void>;
  onClearFiles: () => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const isMetadataLocked = props.files.length === 0 || Boolean(props.validationError);
  const hasSelectedPackage = props.normalizedPaths.length > 0;
  const fileSummary = `${props.files.length} files \u00b7 ${formatBytes(props.totalBytes)}`;
  const prefillSummary =
    props.detectedPrefillFields.length > 0
      ? `Autofilled: ${props.detectedPrefillFields.join(", ")}.`
      : "Review and fill the release details below.";

  const setDirectoryInputRef = (node: HTMLInputElement | null) => {
    directoryInputRef.current = node;
    if (node) {
      node.setAttribute("webkitdirectory", "");
      node.setAttribute("directory", "");
    }
  };
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void (async () => {
      const dropped = event.dataTransfer.items?.length
        ? await expandDroppedItems(event.dataTransfer.items)
        : Array.from(event.dataTransfer.files);
      await props.onPickFiles(dropped);
    })();
  };

  return (
    <Card
      className={`mb-5 ${
        hasSelectedPackage
          ? isDragging
            ? "border-[color:var(--accent)] bg-[rgba(255,107,74,0.06)]"
            : isMetadataLocked
              ? "border-[color:var(--line)] bg-[color:var(--surface-muted)]"
              : "border-emerald-300/45 bg-emerald-50/80 dark:border-emerald-500/30 dark:bg-emerald-950/25"
          : ""
      }`}
    >
      <input
        ref={archiveInputRef}
        className="hidden"
        type="file"
        multiple
        accept=".zip,.tgz,.tar.gz,application/zip,application/gzip,application/x-gzip,application/x-tar"
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          event.target.value = "";
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
          event.target.value = "";
          void props.onPickFiles(selected);
        }}
      />
      {hasSelectedPackage ? (
        <div
          className="transition-colors"
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)]"
                aria-hidden="true"
              >
                <Package size={20} className="text-[color:var(--ink-soft)]" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <strong className="text-sm text-[color:var(--ink)]">
                    {isMetadataLocked ? "Package selected" : "Package detected"}
                  </strong>
                  <span className="text-xs text-[color:var(--ink-soft)]">{fileSummary}</span>
                </div>
                <p className="mt-1 text-sm text-[color:var(--ink-soft)]">{prefillSummary}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {props.normalizedPathSet.has("package.json") ? (
                    <Badge variant="compact">Package manifest</Badge>
                  ) : null}
                  {props.normalizedPathSet.has("openclaw.plugin.json") ? (
                    <Badge variant="compact">Plugin manifest</Badge>
                  ) : null}
                  {props.normalizedPathSet.has(".codex-plugin/plugin.json") ||
                  props.normalizedPathSet.has(".claude-plugin/plugin.json") ||
                  props.normalizedPathSet.has(".cursor-plugin/plugin.json") ? (
                    <Badge variant="compact">Agent metadata</Badge>
                  ) : null}
                  {props.normalizedPathSet.has("readme.md") ||
                  props.normalizedPathSet.has("readme.mdx") ? (
                    <Badge variant="compact">README</Badge>
                  ) : null}
                  {props.ignoredPaths.length > 0 ? (
                    <Badge variant="compact">
                      Ignored {props.ignoredPaths.length} package files
                    </Badge>
                  ) : null}
                </div>
                {props.ignoredPaths.length > 0 ? (
                  <p className="mt-2 text-xs text-[color:var(--ink-soft)]">
                    Ignored: {props.ignoredPaths.slice(0, 4).join(", ")}
                    {props.ignoredPaths.length > 4 ? ", ..." : ""}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
              <Button variant="outline" size="sm" onClick={() => archiveInputRef.current?.click()}>
                Replace archive
              </Button>
              <Button variant="ghost" size="sm" onClick={() => directoryInputRef.current?.click()}>
                Replace folder
              </Button>
              <Button variant="ghost" size="sm" onClick={props.onClearFiles}>
                Clear package
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`relative flex flex-col items-center gap-4 overflow-hidden rounded-[var(--radius-md)] border-2 border-dashed p-8 text-center transition-colors ${
            isDragging
              ? "border-[color:var(--accent)] bg-[rgba(255,107,74,0.06)]"
              : "border-[color:var(--line)] bg-[color:var(--surface-muted)]"
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <UploadDropzoneDecor kind="plugin" />
          <div
            className="relative z-[1] flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--surface)]"
            aria-hidden="true"
          >
            <Package size={28} className="text-[color:var(--ink-soft)]" />
          </div>
          <div className="relative z-[1] flex flex-col items-center gap-2">
            <strong className="text-[color:var(--ink)]">Upload plugin code first</strong>
            <span className="max-w-md text-sm text-[color:var(--ink-soft)]">
              Drag a folder, zip, or tgz here. We inspect the package to unlock and prefill the rest
              of the form.
            </span>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => archiveInputRef.current?.click()}>
                Choose archive
              </Button>
              <Button variant="ghost" size="sm" onClick={() => directoryInputRef.current?.click()}>
                Choose folder
              </Button>
            </div>
          </div>
        </div>
      )}
      {props.validationError ? <Badge variant="warning">{props.validationError}</Badge> : null}
      {props.family === "code-plugin" && props.codePluginFieldIssues.length > 0 ? (
        <Badge variant="warning">
          Missing required OpenClaw package metadata: {props.codePluginFieldIssues.join(", ")}. Add
          these fields to <code>package.json</code> before publishing. See{" "}
          <a
            href={DocsLinks.openclaw.pluginPackageMetadata}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Plugin Setup and Config
          </a>
          .
        </Badge>
      ) : null}
    </Card>
  );
}
