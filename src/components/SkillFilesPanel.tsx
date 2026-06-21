import { useAction } from "convex/react";
import { ChevronDown, FileCode2, FileText, Folder } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { formatBytes } from "./skillDetailUtils";

type SkillFile = Doc<"skillVersions">["files"][number];

type SkillFilesPanelProps = {
  versionId: Id<"skillVersions"> | null;
  latestFiles: SkillFile[];
};

const MOBILE_FILE_LIST_MAX_WIDTH = 899;
const MOBILE_FILE_LIST_PREVIEW_COUNT = 8;

type FileTreeFileNode = {
  type: "file";
  name: string;
  path: string;
  size: number;
};

type FileTreeDirectoryNode = {
  type: "directory";
  name: string;
  path: string;
  children: FileTreeNode[];
};

type FileTreeNode = FileTreeDirectoryNode | FileTreeFileNode;

type MutableDirectoryNode = FileTreeDirectoryNode & {
  directories: Map<string, MutableDirectoryNode>;
};

function createDirectoryNode(name: string, path: string): MutableDirectoryNode {
  return {
    type: "directory",
    name,
    path,
    children: [],
    directories: new Map(),
  };
}

function sortTreeNodes(left: FileTreeNode, right: FileTreeNode) {
  if (left.type !== right.type) return left.type === "file" ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

function stripMutableState(node: MutableDirectoryNode): FileTreeDirectoryNode {
  return {
    type: "directory",
    name: node.name,
    path: node.path,
    children: node.children
      .map((child) => (child.type === "directory" ? stripMutableState(child) : child))
      .sort(sortTreeNodes),
  };
}

function buildFileTree(files: SkillFile[]) {
  const root = createDirectoryNode("", "");
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let currentDirectory = root;
    for (const directoryName of parts.slice(0, -1)) {
      const directoryPath = currentDirectory.path
        ? `${currentDirectory.path}/${directoryName}`
        : directoryName;
      let directory = currentDirectory.directories.get(directoryName);
      if (!directory) {
        directory = createDirectoryNode(directoryName, directoryPath);
        currentDirectory.directories.set(directoryName, directory);
        currentDirectory.children.push(directory);
      }
      currentDirectory = directory;
    }
    currentDirectory.children.push({
      type: "file",
      name: parts.at(-1) ?? file.path,
      path: file.path,
      size: file.size,
    });
  }
  return stripMutableState(root).children;
}

function getFileTreeLevelStyle(level: number) {
  return { "--file-tree-level": level } as CSSProperties;
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
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_FILE_LIST_MAX_WIDTH}px)`);
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
  const fileTree = useMemo(() => buildFileTree(visibleFiles), [visibleFiles]);

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
      if (selectedPath === path && (isLoading || fileContent !== null)) return;
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
    [fileContent, getFileText, isLoading, selectedPath, versionId],
  );

  useEffect(() => {
    if (!versionId || latestFiles.length === 0) return;
    if (selectedPath !== null) return;
    const defaultPath =
      latestFiles.find((file) => file.path === "SKILL.md")?.path ?? latestFiles[0]?.path ?? null;
    if (!defaultPath) return;
    handleSelect(defaultPath);
  }, [handleSelect, latestFiles, selectedPath, versionId]);

  const renderTreeNode = (node: FileTreeNode, level: number): ReactNode => {
    if (node.type === "directory") {
      return (
        <div key={node.path} className="file-tree-group">
          <div className="file-tree-directory" style={getFileTreeLevelStyle(level)}>
            <Folder size={14} aria-hidden="true" />
            <span>{node.name}</span>
          </div>
          {node.children.map((child) => renderTreeNode(child, level + 1))}
        </div>
      );
    }

    const formattedSize = formatBytes(node.size);
    return (
      <button
        key={node.path}
        className={`file-tree-file${selectedPath === node.path ? " is-active" : ""}`}
        style={getFileTreeLevelStyle(level)}
        type="button"
        onClick={() => handleSelect(node.path)}
        aria-current={selectedPath === node.path ? "true" : undefined}
        aria-label={`${node.path} ${formattedSize}`}
      >
        <FileText size={14} aria-hidden="true" />
        <span className="file-tree-name">{node.name}</span>
        <span className="file-meta">{formattedSize}</span>
      </button>
    );
  };

  return (
    <div className="tab-body skill-files-panel">
      <div className="file-browser">
        <div className={`file-list${isMobile && hiddenFilesCount > 0 ? " has-hidden-files" : ""}`}>
          <div className="file-list-header">
            <h3 className="section-title text-[1.05rem] m-0">Files</h3>
            <span className="file-list-count">{latestFiles.length} total</span>
          </div>
          <div className={`file-list-body${showAllMobileFiles ? " is-expanded" : ""}`}>
            {latestFiles.length === 0 ? (
              <div className="stat">No files available.</div>
            ) : (
              fileTree.map((node) => renderTreeNode(node, 0))
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
