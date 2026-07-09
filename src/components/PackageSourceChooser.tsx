import { Package, Upload } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { expandDroppedItems } from "../lib/uploadFiles";
import { formatBytes } from "../routes/upload/-utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { UploadDropzoneDecor } from "./UploadDropzoneDecor";

const PACKAGE_FILE_LIST_LIMIT = 8;
export type PackagePickSource = "archive" | "folder";
const PACKAGE_PATH_PRIORITY = new Map(
  [
    "package.json",
    "openclaw.plugin.json",
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
    "readme.md",
    "readme.mdx",
  ].map((path, index) => [path, index]),
);

function sortPackagePaths(paths: string[]) {
  return [...paths].sort((a, b) => {
    const aPriority = PACKAGE_PATH_PRIORITY.get(a.toLowerCase()) ?? Number.POSITIVE_INFINITY;
    const bPriority = PACKAGE_PATH_PRIORITY.get(b.toLowerCase()) ?? Number.POSITIVE_INFINITY;
    if (aPriority !== bPriority) return aPriority - bPriority;

    const aDepth = a.split("/").length;
    const bDepth = b.split("/").length;
    if (aDepth !== bDepth) return aDepth - bDepth;

    return a.localeCompare(b);
  });
}

function isArchiveUpload(file: File) {
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith(".zip") || lowerName.endsWith(".tgz") || lowerName.endsWith(".tar.gz");
}

function inferPackagePickSource(selected: File[]): PackagePickSource {
  return selected.some(isArchiveUpload) ? "archive" : "folder";
}

function getPackagePathBadges(
  path: string,
  options: {
    hasMetadataIssues: boolean;
  },
) {
  const lowerPath = path.toLowerCase();
  const badges = [];

  if (lowerPath === "package.json") {
    badges.push(
      <Badge key="package" variant="compact" size="sm">
        Package manifest
      </Badge>,
    );
    if (options.hasMetadataIssues) {
      badges.push(
        <Badge
          key="metadata-missing"
          variant="destructive"
          size="sm"
          title="Missing OpenClaw compatibility metadata"
        >
          Missing metadata
        </Badge>,
      );
    }
    // Do not show a "Compatibility" badge for metadata presence alone.
    // This upload flow does not validate semantic version/range compatibility yet.
  }

  if (lowerPath === "openclaw.plugin.json") {
    badges.push(
      <Badge key="plugin" variant="compact" size="sm">
        Plugin manifest
      </Badge>,
    );
  }

  if (
    lowerPath === ".codex-plugin/plugin.json" ||
    lowerPath === ".claude-plugin/plugin.json" ||
    lowerPath === ".cursor-plugin/plugin.json"
  ) {
    badges.push(
      <Badge key="agent" variant="compact" size="sm">
        Agent metadata
      </Badge>,
    );
  }

  if (lowerPath === "readme.md" || lowerPath === "readme.mdx") {
    badges.push(
      <Badge key="readme" variant="compact" size="sm">
        README
      </Badge>,
    );
  }

  return badges;
}

export function PackageSourceChooser(props: {
  files: File[];
  totalBytes: number;
  normalizedPaths: string[];
  normalizedPathSet: Set<string>;
  selectedSourceKind: PackagePickSource | null;
  ignoredPaths: string[];
  detectedPrefillFields: string[];
  family: "code-plugin" | "bundle-plugin";
  validationError: string | null;
  codePluginFieldIssues: string[];
  onPickFiles: (selected: File[], sourceKind: PackagePickSource) => Promise<void>;
  onClearFiles: () => void;
  emptyStateLayout?: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const isMetadataLocked = props.files.length === 0 || Boolean(props.validationError);
  const hasSelectedPackage = props.normalizedPaths.length > 0;
  const fileSummary = `${props.files.length} files \u00b7 ${formatBytes(props.totalBytes)}`;
  const sortedPackagePaths = sortPackagePaths(props.normalizedPaths);
  const visiblePackagePaths = sortedPackagePaths.slice(0, PACKAGE_FILE_LIST_LIMIT);
  const hiddenPackagePathCount = Math.max(
    sortedPackagePaths.length - visiblePackagePaths.length,
    0,
  );
  const replaceSourceKind = props.selectedSourceKind ?? "archive";
  const replaceLabel = replaceSourceKind === "folder" ? "Replace folder" : "Replace package";
  const hasMetadataIssues =
    props.family === "code-plugin" && props.codePluginFieldIssues.length > 0;
  const hasPackagePanelFooter = props.ignoredPaths.length > 0 || Boolean(props.validationError);
  const selectedPackagePanelToneClass = isDragging
    ? "border-[color:var(--accent)] bg-[rgba(255,107,74,0.06)]"
    : "border-[color:var(--line)] bg-[color:var(--surface-muted)]";
  const selectedPackagePanelBgClass = isDragging
    ? "bg-[rgba(255,107,74,0.06)]"
    : "bg-[color:var(--surface-muted)]";

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
      await props.onPickFiles(dropped, inferPackagePickSource(dropped));
    })();
  };

  return (
    <>
      <input
        ref={archiveInputRef}
        className="hidden"
        type="file"
        multiple
        accept=".zip,.tgz,.tar.gz,application/zip,application/gzip,application/x-gzip,application/x-tar"
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          event.target.value = "";
          void props.onPickFiles(selected, "archive");
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
          void props.onPickFiles(selected, "folder");
        }}
      />
      {hasSelectedPackage ? (
        <div
          className={`mb-5 overflow-hidden rounded-[var(--radius-md)] border transition-colors ${selectedPackagePanelToneClass}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div className="flex flex-col gap-4 px-4 pt-4 pb-2 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)]"
                aria-hidden="true"
              >
                <Package size={16} className="text-[color:var(--ink-soft)]" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <strong className="text-sm text-[color:var(--ink)]">
                    {isMetadataLocked ? "Package selected" : "Package detected"}
                  </strong>
                  <span className="text-xs text-[color:var(--ink-soft)]">{fileSummary}</span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-4 md:justify-end">
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => {
                  if (replaceSourceKind === "folder") {
                    directoryInputRef.current?.click();
                    return;
                  }
                  archiveInputRef.current?.click();
                }}
              >
                {replaceLabel}
              </Button>
              <button
                type="button"
                className="cursor-pointer text-xs font-medium text-[color:var(--ink-soft)] transition-colors hover:text-[color:var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg)]"
                onClick={() => {
                  props.onClearFiles();
                }}
              >
                Clear package
              </button>
            </div>
          </div>
          <div className="mt-2 overflow-hidden rounded-t-[calc(var(--radius-md)+8px)] border-t border-[color:var(--line)] bg-[color:var(--surface)]">
            <div className="flex max-h-[300px] flex-col gap-1 overflow-y-auto p-3">
              {visiblePackagePaths.map((path, index) => {
                const badges = getPackagePathBadges(path, {
                  hasMetadataIssues,
                });
                return (
                  <div
                    key={`${index}:${path}`}
                    className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[color:var(--surface-muted)] px-3 py-1.5 text-sm text-[color:var(--ink-soft)]"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono" title={path}>
                      {path}
                    </span>
                    {badges.length > 0 ? (
                      <div className="flex shrink-0 flex-wrap justify-end gap-1.5">{badges}</div>
                    ) : null}
                  </div>
                );
              })}
              {hiddenPackagePathCount > 0 ? (
                <div className="px-3 py-1.5 text-xs text-[color:var(--ink-soft)]">
                  +{hiddenPackagePathCount} more
                </div>
              ) : null}
            </div>
            {hasPackagePanelFooter ? (
              <div
                className={`border-t border-[color:var(--line)] px-3 py-2 text-xs text-[color:var(--ink-soft)] ${selectedPackagePanelBgClass}`}
              >
                <div className="flex flex-col gap-1">
                  {props.ignoredPaths.length > 0 ? (
                    <p>
                      Ignored: {props.ignoredPaths.slice(0, 4).join(", ")}
                      {props.ignoredPaths.length > 4 ? ", ..." : ""}
                    </p>
                  ) : null}
                  {props.validationError ? (
                    <p className="text-status-error-fg">{props.validationError}</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <Card className={props.emptyStateLayout ? "publish-empty-upload-card" : "mb-5"}>
          <div
            data-dragging={isDragging ? "true" : undefined}
            className={`${
              props.emptyStateLayout ? "publish-empty-dropzone" : "p-8"
            } relative flex flex-col items-center gap-4 overflow-hidden rounded-[var(--radius-md)] border-2 border-dashed text-center transition-colors ${
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
            <UploadDropzoneDecor active={isDragging} kind="plugin" />
            <div className="relative z-[1] flex w-full flex-col items-center gap-3">
              <div className="flex items-center gap-3">
                <Upload className="h-4 w-4 text-[color:var(--ink-soft)]" aria-hidden="true" />
                <strong className="text-[color:var(--ink)]">Upload plugin first</strong>
              </div>
              <span className="max-w-[520px] text-sm text-[color:var(--ink-soft)]">
                Drop a plugin file or folder here.
              </span>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => archiveInputRef.current?.click()}
                >
                  Choose file
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => directoryInputRef.current?.click()}
                >
                  Choose folder
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
