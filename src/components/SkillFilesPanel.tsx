import { useAction } from "convex/react";
import { ChevronDown, FileCode2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { formatBytes } from "./skillDetailUtils";

type SkillFile = Doc<"skillVersions">["files"][number];

type SkillFilesPanelProps = {
  versionId: Id<"skillVersions"> | null;
  latestFiles: SkillFile[];
};

const MOBILE_FILE_LIST_BREAKPOINT = 900;
const MOBILE_FILE_LIST_PREVIEW_COUNT = 8;

function splitFilePath(path: string) {
  const lastSlashIndex = path.lastIndexOf("/");
  if (lastSlashIndex === -1) return { directory: "", filename: path };
  return {
    directory: path.slice(0, lastSlashIndex + 1),
    filename: path.slice(lastSlashIndex + 1),
  };
}

export function SkillFilesPanel({ versionId, latestFiles }: SkillFilesPanelProps) {
  const getFileText = useAction(api.skills.getFileText);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{ size: number; sha256: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showAllMobileFiles, setShowAllMobileFiles] = useState(false);
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
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return () => {};
    }
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_FILE_LIST_BREAKPOINT}px)`);
    const syncMobileState = () => {
      const nextIsMobile = mediaQuery.matches;
      setIsMobile(nextIsMobile);
      if (!nextIsMobile) {
        setShowAllMobileFiles(false);
      }
    };
    syncMobileState();
    mediaQuery.addEventListener("change", syncMobileState);
    return () => {
      mediaQuery.removeEventListener("change", syncMobileState);
    };
  }, []);

  useEffect(() => {
    setShowAllMobileFiles(false);
  }, [versionId]);

  const visibleFiles = useMemo(() => {
    if (!isMobile || showAllMobileFiles) return latestFiles;
    return latestFiles.slice(0, MOBILE_FILE_LIST_PREVIEW_COUNT);
  }, [isMobile, latestFiles, showAllMobileFiles]);

  const hiddenFilesCount = latestFiles.length - visibleFiles.length;

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
    <div className="tab-body">
      <div className="file-browser">
        <div className="file-list">
          <div className="file-list-header">
            <h3 className="section-title text-[1.05rem] m-0">Files</h3>
            <span className="file-list-count">{latestFiles.length} total</span>
          </div>
          <div className={`file-list-body${showAllMobileFiles ? " is-expanded" : ""}`}>
            {latestFiles.length === 0 ? (
              <div className="stat">No files available.</div>
            ) : (
              visibleFiles.map((file) => {
                const { directory, filename } = splitFilePath(file.path);
                const formattedSize = formatBytes(file.size);
                return (
                  <button
                    key={file.path}
                    className={`file-row file-row-button${
                      selectedPath === file.path ? " is-active" : ""
                    }`}
                    type="button"
                    onClick={() => handleSelect(file.path)}
                    aria-current={selectedPath === file.path ? "true" : undefined}
                    aria-label={`${file.path} ${formattedSize}`}
                  >
                    <span className="file-row-path">
                      {directory ? <span className="file-path-dir">{directory}</span> : null}
                      <span className="file-path-name">{filename}</span>
                    </span>
                    <span className="file-meta">{formattedSize}</span>
                  </button>
                );
              })
            )}
          </div>
          {isMobile && hiddenFilesCount > 0 ? (
            <div className="file-list-see-all-wrap">
              <div className="file-list-see-all-gradient" aria-hidden="true" />
              <button
                className="file-list-see-all"
                type="button"
                onClick={() => setShowAllMobileFiles(true)}
              >
                <ChevronDown size={14} aria-hidden="true" />
                <span>See all</span>
              </button>
            </div>
          ) : null}
        </div>
        <div className="file-viewer">
          <div className="file-viewer-header">
            <div className="file-path">{selectedPath ?? "Select a file"}</div>
          </div>
          <div className="file-viewer-body">
            {isLoading ? (
              <div className="stat">Loading…</div>
            ) : fileError ? (
              <div className="stat">Failed to load file: {fileError}</div>
            ) : fileContent ? (
              <pre className="file-viewer-code">{fileContent}</pre>
            ) : (
              <div className="file-viewer-empty">
                <FileCode2 size={22} className="file-viewer-empty-icon" aria-hidden="true" />
                <p className="file-viewer-empty-text">Select a file to preview.</p>
              </div>
            )}
          </div>
          {fileMeta ? (
            <div className="file-viewer-meta">
              <span className="file-meta">{formatBytes(fileMeta.size)}</span>
              <span className="file-meta">{fileMeta.sha256.slice(0, 12)}...</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
