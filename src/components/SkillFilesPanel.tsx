import { useAction } from "convex/react";
import { ArrowLeft, FileText, Fingerprint, Folder } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { CodeWrapToggleButton, useCodeWrapToggle } from "./CodeWrapToggle";
import { formatBytes } from "./skillDetailUtils";

type SkillFile = Doc<"skillVersions">["files"][number];

type SkillFilesPanelProps = {
  versionId: Id<"skillVersions"> | null;
  latestFiles: SkillFile[];
};

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
  const isMounted = useRef(true);
  const requestId = useRef(0);
  const fileListRef = useRef<HTMLDivElement>(null);
  const fileCache = useRef(new Map<string, { text: string; size: number; sha256: string }>());
  const [viewerMinHeight, setViewerMinHeight] = useState<number | undefined>();
  const { preRef, isWrapped, canWrap, toggleWrap } = useCodeWrapToggle(fileContent ?? "");

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      requestId.current += 1;
    };
  }, []);

  const fileTree = useMemo(() => buildFileTree(latestFiles), [latestFiles]);
  const selectedFileName = selectedPath?.split("/").pop() ?? selectedPath ?? "";

  useEffect(() => {
    requestId.current += 1;

    setSelectedPath(null);
    setFileContent(null);
    setFileMeta(null);
    setFileError(null);
    setIsLoading(false);
    setViewerMinHeight(undefined);

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
      if (fileListRef.current) {
        setViewerMinHeight(fileListRef.current.offsetHeight);
      }
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

  const handleBack = () => {
    requestId.current += 1;
    setSelectedPath(null);
    setFileContent(null);
    setFileMeta(null);
    setFileError(null);
    setIsLoading(false);
    setViewerMinHeight(undefined);
  };

  const selectedFileSize =
    fileMeta?.size ?? latestFiles.find((file) => file.path === selectedPath)?.size;

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
    const isPrimary = node.path === "SKILL.md";
    return (
      <button
        key={node.path}
        className={`file-tree-file${isPrimary ? " is-primary" : ""}`}
        style={getFileTreeLevelStyle(level)}
        type="button"
        onClick={() => handleSelect(node.path)}
        aria-label={`${node.path}${isPrimary ? " main" : ""} ${formattedSize}`}
      >
        <FileText size={14} aria-hidden="true" />
        <span className="file-tree-name-wrap">
          <span className="file-tree-name">{node.name}</span>
          {isPrimary ? <span className="file-tree-main-badge">main</span> : null}
        </span>
        <span className="file-meta">{formattedSize}</span>
      </button>
    );
  };

  return (
    <div className="tab-body skill-files-panel">
      <div className={`file-browser${selectedPath ? " is-viewing-file" : ""}`}>
        {selectedPath ? (
          <div
            className="file-viewer"
            style={viewerMinHeight ? { minHeight: viewerMinHeight } : undefined}
          >
            <div className="file-viewer-header">
              <button
                className="file-viewer-back"
                type="button"
                onClick={handleBack}
                aria-label="Back to file list"
              >
                <ArrowLeft size={15} aria-hidden="true" />
                <span className="file-viewer-back-label">Back</span>
              </button>
              <div className="file-viewer-title" aria-label={selectedPath}>
                <span className="file-viewer-filename">{selectedFileName}</span>
                {selectedFileSize !== undefined ? (
                  <>
                    <span className="file-viewer-title-sep" aria-hidden="true">
                      ·
                    </span>
                    <span className="file-viewer-size">{formatBytes(selectedFileSize)}</span>
                  </>
                ) : null}
              </div>
              <div className="file-viewer-header-end">
                {canWrap ? (
                  <span className="markdown-code-block-actions">
                    <CodeWrapToggleButton isWrapped={isWrapped} onToggle={toggleWrap} />
                  </span>
                ) : null}
              </div>
            </div>
            <div className="file-viewer-body">
              {isLoading ? (
                <div className="stat">Loading…</div>
              ) : fileError ? (
                <div className="stat">Failed to load file: {fileError}</div>
              ) : fileContent ? (
                <pre ref={preRef} className="file-viewer-code" data-wrap={isWrapped}>
                  {fileContent}
                </pre>
              ) : null}
            </div>
            {fileMeta ? (
              <div className="file-viewer-meta">
                <Fingerprint size={14} className="file-viewer-hash-icon" aria-hidden="true" />
                <span className="file-viewer-hash">{fileMeta.sha256}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="file-list" ref={fileListRef}>
            <div className="file-list-header">
              <h3 className="section-title text-[1.05rem] m-0">Files</h3>
              <span className="file-list-count">{latestFiles.length} total</span>
            </div>
            <div className="file-list-body">
              {latestFiles.length === 0 ? (
                <div className="stat">No files available.</div>
              ) : (
                fileTree.map((node) => renderTreeNode(node, 0))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
