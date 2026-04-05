import { useAction } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { MarkdownPreview } from "./MarkdownPreview";
import { formatBytes } from "./skillDetailUtils";
import { Skeleton } from "./ui/skeleton";

type SkillFile = Doc<"skillVersions">["files"][number];

type SkillFilesPanelProps = {
  versionId: Id<"skillVersions"> | null;
  readmeContent: string | null;
  readmeError: string | null;
  latestFiles: SkillFile[];
};

export function SkillFilesPanel({
  versionId,
  readmeContent,
  readmeError,
  latestFiles,
}: SkillFilesPanelProps) {
  const getFileText = useAction(api.skills.getFileText);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{ size: number; sha256: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const isMounted = useRef(true);
  const requestId = useRef(0);
  const fileCache = useRef(new Map<string, { text: string; size: number; sha256: string }>());

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      requestId.current += 1;
    };
  }, []);

  useEffect(() => {
    requestId.current += 1;

    setSelectedPath(null);
    setFileContent(null);
    setFileMeta(null);
    setFileError(null);
    setIsLoading(false);

    if (versionId === null) return;
  }, [versionId]);

  const handleSelect = useCallback(
    (path: string) => {
      if (!versionId) return;
      const cacheKey = `${versionId}:${path}`;
      const cached = fileCache.current.get(cacheKey);

      requestId.current += 1;
      const current = requestId.current;
      setSelectedPath(path);
      setFileError(null);
      if (cached) {
        setFileContent(cached.text);
        setFileMeta({ size: cached.size, sha256: cached.sha256 });
        setIsLoading(false);
        return;
      }

      setFileContent(null);
      setFileMeta(null);
      setIsLoading(true);
      void getFileText({ versionId, path })
        .then((data) => {
          if (!isMounted.current) return;
          if (requestId.current !== current) return;
          fileCache.current.set(cacheKey, data);
          setFileContent(data.text);
          setFileMeta({ size: data.size, sha256: data.sha256 });
          setIsLoading(false);
        })
        .catch((error) => {
          if (!isMounted.current) return;
          if (requestId.current !== current) return;
          setFileError(error instanceof Error ? error.message : "Failed to load file");
          setIsLoading(false);
        });
    },
    [getFileText, versionId],
  );

  return (
    <div className="grid max-w-full gap-5 overflow-x-auto">
      <div>
        <h2 className="m-0 font-display text-[1.2rem] font-bold text-[color:var(--ink)]">
          SKILL.md
        </h2>
        <div>
          {readmeContent ? (
            <MarkdownPreview>{readmeContent}</MarkdownPreview>
          ) : readmeError ? (
            <div className="text-sm text-[color:var(--ink-soft)]">
              Failed to load SKILL.md: {readmeError}
            </div>
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
        </div>
      </div>
      <div className="grid gap-0 overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--line)] md:grid-cols-[minmax(180px,280px)_1fr]">
        <div className="flex flex-col border-b border-[color:var(--line)] md:border-r md:border-b-0">
          <div className="flex items-center justify-between border-b border-[color:var(--line)] bg-[color:var(--surface-muted)] px-3 py-2">
            <h3 className="m-0 font-display text-[1.05rem] font-bold text-[color:var(--ink)]">
              Files
            </h3>
            <span className="m-0 text-sm text-[color:var(--ink-soft)]">
              {latestFiles.length} total
            </span>
          </div>
          <div className="flex max-h-[400px] flex-col overflow-y-auto">
            {latestFiles.length === 0 ? (
              <div className="px-3 py-2 text-sm text-[color:var(--ink-soft)]">
                No files available.
              </div>
            ) : (
              latestFiles.map((file) => (
                <button
                  key={file.path}
                  className={`flex w-full cursor-pointer items-center justify-between border-none px-3 py-2 text-left text-sm transition-colors hover:bg-[color:var(--surface-muted)] ${
                    selectedPath === file.path
                      ? "bg-[color:var(--surface-muted)] font-semibold text-[color:var(--ink)]"
                      : "bg-transparent text-[color:var(--ink)]"
                  }`}
                  type="button"
                  onClick={() => handleSelect(file.path)}
                  aria-current={selectedPath === file.path ? "true" : undefined}
                >
                  <span className="truncate font-mono text-xs">{file.path}</span>
                  <span className="ml-2 shrink-0 text-xs text-[color:var(--ink-soft)]">
                    {formatBytes(file.size)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="flex flex-col">
          <div className="flex items-center justify-between border-b border-[color:var(--line)] bg-[color:var(--surface-muted)] px-3 py-2">
            <div className="truncate font-mono text-xs">{selectedPath ?? "Select a file"}</div>
            {fileMeta ? (
              <span className="ml-2 shrink-0 text-xs text-[color:var(--ink-soft)]">
                {formatBytes(fileMeta.size)} · {fileMeta.sha256.slice(0, 12)}…
              </span>
            ) : null}
          </div>
          <div className="min-h-[200px] p-3">
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : fileError ? (
              <div className="text-sm text-[color:var(--ink-soft)]">
                Failed to load file: {fileError}
              </div>
            ) : fileContent ? (
              <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                {fileContent}
              </pre>
            ) : (
              <div className="text-sm text-[color:var(--ink-soft)]">Select a file to preview.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
