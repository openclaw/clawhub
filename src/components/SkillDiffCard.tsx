import type { DiffEditorProps, DiffOnMount, MonacoDiffEditor } from "@monaco-editor/react";
import { DiffEditor, useMonaco } from "@monaco-editor/react";
import { useAction } from "convex/react";
import {
  AlignJustify,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  buildFileDiffList,
  getDefaultDiffSelection,
  MAX_DIFF_FILE_BYTES,
  resolveLatestVersionId,
  resolvePreviousVersionId,
  selectDefaultFilePath,
  sortVersionsBySemver,
} from "../lib/diffing";
import { ensureMonacoLoader } from "../lib/monacoLoader";
import { isDarkThemeResolved, onThemeChange } from "../lib/theme";
import { ClientOnly } from "./ClientOnly";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

type SkillDiffCardProps = {
  skill: Doc<"skills">;
  versions: Doc<"skillVersions">[];
  variant?: "card" | "embedded";
};

type VersionOption = {
  value: Id<"skillVersions">;
  label: string;
  group: "Special" | "Tags" | "Versions";
  disabled?: boolean;
};

type FileSide = "left" | "right";

type SizeWarning = {
  side: FileSide;
  path: string;
};

type PreviewWarning = {
  side: FileSide;
  path: string;
};

const EMPTY_DIFF_TEXT = "";
const COMPACT_DIFF_THRESHOLD = 768;
const EMPTY_DIFF_STATS = { additions: 0, deletions: 0, hunks: 0 };
const FILE_STATUS_LABELS = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  same: "Unchanged",
} as const;

function countChangedLines(startLineNumber: number, endLineNumber: number) {
  if (endLineNumber === 0) return 0;
  return Math.max(0, endLineNumber - startLineNumber + 1);
}

function getDefaultViewMode() {
  if (typeof window === "undefined") return "split";
  return window.matchMedia(`(max-width: ${COMPACT_DIFF_THRESHOLD}px)`).matches ? "inline" : "split";
}

function useCompactDiffLayout(threshold = COMPACT_DIFF_THRESHOLD) {
  const ref = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${threshold}px)`).matches;
  });

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return () => {};

    const mediaQuery = window.matchMedia(`(max-width: ${threshold}px)`);
    const sync = (width: number) => {
      setIsCompact(width < threshold || mediaQuery.matches);
    };

    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      sync(width);
    });
    observer.observe(element);
    sync(element.getBoundingClientRect().width);

    const onMediaChange = () => sync(element.getBoundingClientRect().width);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onMediaChange);
      return () => {
        observer.disconnect();
        mediaQuery.removeEventListener("change", onMediaChange);
      };
    }

    mediaQuery.addListener(onMediaChange);
    return () => {
      observer.disconnect();
      mediaQuery.removeListener(onMediaChange);
    };
  }, [threshold]);

  return { ref, isCompact };
}

function DiffViewerLoading() {
  return (
    <div
      className="diff-skeleton-editor diff-skeleton-editor-embedded"
      role="status"
      aria-label="Loading diff"
    >
      <div className="diff-skeleton-gutter" aria-hidden="true">
        <Skeleton />
        <Skeleton />
        <Skeleton />
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
      <div className="diff-skeleton-code" aria-hidden="true">
        <Skeleton className="w-[18%]" />
        <Skeleton className="w-[58%]" />
        <Skeleton className="w-[82%]" />
        <Skeleton className="w-[72%]" />
        <Skeleton className="mt-4 w-[34%]" />
        <Skeleton className="w-[66%]" />
        <Skeleton className="w-[48%]" />
      </div>
    </div>
  );
}

export function SkillDiffCard({ skill, versions, variant = "card" }: SkillDiffCardProps) {
  const getFilePreview = useAction(api.skills.getFilePreview);
  const monaco = useMonaco();
  const { ref: containerRef, isCompact } = useCompactDiffLayout();
  const [viewMode, setViewMode] = useState<"split" | "inline">(getDefaultViewMode);
  const [leftVersionId, setLeftVersionId] = useState<Id<"skillVersions"> | null>(null);
  const [rightVersionId, setRightVersionId] = useState<Id<"skillVersions"> | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [leftText, setLeftText] = useState(EMPTY_DIFF_TEXT);
  const [rightText, setRightText] = useState(EMPTY_DIFF_TEXT);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monacoReady, setMonacoReady] = useState(false);
  const [monacoError, setMonacoError] = useState<string | null>(null);
  const [sizeWarning, setSizeWarning] = useState<SizeWarning | null>(null);
  const [previewWarning, setPreviewWarning] = useState<PreviewWarning | null>(null);
  const cacheRef = useRef(new Map<string, string | null>());
  const userSelectedViewModeRef = useRef(false);
  const diffEditorRef = useRef<MonacoDiffEditor | null>(null);
  const diffUpdateDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const [diffStats, setDiffStats] = useState(EMPTY_DIFF_STATS);

  const versionEntries = useMemo(
    () => versions.map((entry) => ({ id: entry._id, version: entry.version })),
    [versions],
  );
  const orderedVersions = useMemo(() => sortVersionsBySemver(versionEntries), [versionEntries]);
  const versionById = useMemo(
    () => new Map(versions.map((entry) => [entry._id, entry])),
    [versions],
  );

  const latestId = useMemo(
    () => resolveLatestVersionId(versionEntries, skill.tags),
    [versionEntries, skill.tags],
  );
  const previousId = useMemo(
    () => resolvePreviousVersionId(versionEntries, latestId),
    [versionEntries, latestId],
  );

  const versionOptions = useMemo(() => {
    const options: VersionOption[] = [];
    if (latestId) {
      const version = versionById.get(latestId)?.version;
      options.push({
        value: latestId,
        label: version ? `latest (v${version})` : "latest",
        group: "Special",
      });
    }
    if (previousId) {
      const version = versionById.get(previousId)?.version;
      options.push({
        value: previousId,
        label: version ? `previous (v${version})` : "previous",
        group: "Special",
      });
    } else if (versions.length > 0) {
      options.push({
        value: versions[0]._id,
        label: "previous (unavailable)",
        group: "Special",
        disabled: true,
      });
    }

    const tagEntries = Object.entries(skill.tags ?? {})
      .filter(([tag]) => tag !== "latest")
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [tag, versionId] of tagEntries) {
      const version = versionById.get(versionId)?.version;
      options.push({
        value: versionId,
        label: version ? `tag: ${tag} (v${version})` : `tag: ${tag}`,
        group: "Tags",
        disabled: !versionById.has(versionId),
      });
    }

    for (const entry of orderedVersions) {
      options.push({
        value: entry.id,
        label: `v${entry.version}`,
        group: "Versions",
      });
    }

    return options;
  }, [latestId, previousId, orderedVersions, skill.tags, versionById, versions]);

  useEffect(() => {
    if (!versions.length) return;
    const defaults = getDefaultDiffSelection(versionEntries, skill.tags);
    setLeftVersionId((current) => {
      if (current && versionById.has(current)) return current;
      return defaults.leftId ? (defaults.leftId as Id<"skillVersions">) : null;
    });
    setRightVersionId((current) => {
      if (current && versionById.has(current)) return current;
      return defaults.rightId ? (defaults.rightId as Id<"skillVersions">) : null;
    });
  }, [versionEntries, skill.tags, versionById, versions.length]);

  const leftVersion = leftVersionId ? (versionById.get(leftVersionId) ?? null) : null;
  const rightVersion = rightVersionId ? (versionById.get(rightVersionId) ?? null) : null;

  const fileDiffItems = useMemo(() => {
    return buildFileDiffList(leftVersion?.files ?? [], rightVersion?.files ?? []);
  }, [leftVersion, rightVersion]);
  const changedFileItems = useMemo(
    () => fileDiffItems.filter((item) => item.status !== "same"),
    [fileDiffItems],
  );
  const reviewFileItems = changedFileItems.length > 0 ? changedFileItems : fileDiffItems;

  useEffect(() => {
    if (!reviewFileItems.length) {
      setSelectedPath(null);
      return;
    }
    setSelectedPath((current) => {
      if (current && reviewFileItems.some((item) => item.path === current)) return current;
      return selectDefaultFilePath(reviewFileItems);
    });
  }, [reviewFileItems]);

  const selectedItem = useMemo(
    () => fileDiffItems.find((item) => item.path === selectedPath) ?? null,
    [fileDiffItems, selectedPath],
  );
  const selectedReviewIndex = reviewFileItems.findIndex((item) => item.path === selectedPath);
  const hasMultipleReviewFiles = reviewFileItems.length > 1;
  const canSelectPreviousFile = selectedReviewIndex > 0;
  const canSelectNextFile =
    selectedReviewIndex >= 0 && selectedReviewIndex < reviewFileItems.length - 1;

  const selectRelativeFile = (offset: -1 | 1) => {
    const nextItem = reviewFileItems[selectedReviewIndex + offset];
    if (nextItem) setSelectedPath(nextItem.path);
  };

  useEffect(() => {
    setDiffStats(EMPTY_DIFF_STATS);
  }, [leftVersionId, rightVersionId, selectedPath]);

  const handleDiffMount = useCallback<DiffOnMount>((editor) => {
    diffEditorRef.current = editor;
    diffUpdateDisposableRef.current?.dispose();

    const syncDiffStats = () => {
      const changes = editor.getLineChanges() ?? [];
      let additions = 0;
      let deletions = 0;
      for (const change of changes) {
        additions += countChangedLines(
          change.modifiedStartLineNumber,
          change.modifiedEndLineNumber,
        );
        deletions += countChangedLines(
          change.originalStartLineNumber,
          change.originalEndLineNumber,
        );
      }
      setDiffStats({ additions, deletions, hunks: changes.length });
    };

    diffUpdateDisposableRef.current = editor.onDidUpdateDiff(syncDiffStats);
    syncDiffStats();
  }, []);

  useEffect(() => {
    return () => {
      diffUpdateDisposableRef.current?.dispose();
      diffUpdateDisposableRef.current = null;
      diffEditorRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPreview(versionId: Id<"skillVersions">, path: string) {
      const cacheKey = `${versionId}:${path}`;
      const cached = cacheRef.current.get(cacheKey);
      if (cached !== undefined) return cached;
      const result = await getFilePreview({ versionId, path });
      cacheRef.current.set(cacheKey, result.text);
      return result.text;
    }

    async function load() {
      if (!selectedItem || !leftVersionId || !rightVersionId) {
        setLeftText(EMPTY_DIFF_TEXT);
        setRightText(EMPTY_DIFF_TEXT);
        setError(null);
        setSizeWarning(null);
        setPreviewWarning(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      setSizeWarning(null);
      setPreviewWarning(null);

      const leftFile = selectedItem.left;
      const rightFile = selectedItem.right;
      const warnings: SizeWarning[] = [];

      if (leftFile && leftFile.size > MAX_DIFF_FILE_BYTES) {
        warnings.push({ side: "left", path: leftFile.path });
      }
      if (rightFile && rightFile.size > MAX_DIFF_FILE_BYTES) {
        warnings.push({ side: "right", path: rightFile.path });
      }

      if (warnings.length) {
        if (!cancelled) {
          setSizeWarning(warnings[0]);
          setLeftText(EMPTY_DIFF_TEXT);
          setRightText(EMPTY_DIFF_TEXT);
          setIsLoading(false);
        }
        return;
      }

      try {
        const [nextLeft, nextRight] = await Promise.all([
          leftFile ? loadPreview(leftVersionId, leftFile.path) : Promise.resolve(""),
          rightFile ? loadPreview(rightVersionId, rightFile.path) : Promise.resolve(""),
        ]);
        if (cancelled) return;
        const unavailable =
          leftFile && nextLeft === null
            ? { side: "left" as const, path: leftFile.path }
            : rightFile && nextRight === null
              ? { side: "right" as const, path: rightFile.path }
              : null;
        if (unavailable) {
          setPreviewWarning(unavailable);
          setLeftText(EMPTY_DIFF_TEXT);
          setRightText(EMPTY_DIFF_TEXT);
          return;
        }
        setLeftText(nextLeft ?? EMPTY_DIFF_TEXT);
        setRightText(nextRight ?? EMPTY_DIFF_TEXT);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load diff");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [getFilePreview, leftVersionId, rightVersionId, selectedItem]);

  useEffect(() => {
    let cancelled = false;
    void ensureMonacoLoader()
      .then(() => {
        if (!cancelled) setMonacoReady(true);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setMonacoError(
            loadError instanceof Error ? loadError.message : "Failed to load diff viewer",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!monaco || typeof document === "undefined") return () => {};
    const syncTheme = () => applyMonacoTheme(monaco);
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-theme-family", "data-theme-resolved"],
    });
    const removeThemeListener = onThemeChange(syncTheme);
    syncTheme();
    return () => {
      observer.disconnect();
      removeThemeListener();
    };
  }, [monaco]);

  useEffect(() => {
    if (!userSelectedViewModeRef.current) {
      setViewMode(isCompact ? "inline" : "split");
    }
  }, [isCompact]);

  function updateViewMode(nextViewMode: "split" | "inline") {
    userSelectedViewModeRef.current = true;
    setViewMode(nextViewMode);
  }

  const diffUnavailable = versions.length < 2;
  const selectionReady = Boolean(leftVersionId && rightVersionId);
  const fileSelected = Boolean(selectedItem);
  const diffOptions = useMemo(() => buildDiffOptions(viewMode, isCompact), [viewMode, isCompact]);

  const containerClass = variant === "card" ? "card diff-card" : "diff-card diff-card-embedded";

  return (
    <div ref={containerRef} className={containerClass}>
      {variant === "card" ? (
        <div className="diff-header">
          <div className="diff-header-copy">
            <h2 className="section-title text-[1.2rem] m-0">Version diff</h2>
            <p className="section-subtitle m-0">Inline or side-by-side diff for any file.</p>
          </div>
        </div>
      ) : null}

      {!diffUnavailable ? (
        <div className="diff-toolbar">
          <div className="diff-version-row">
            <div className="diff-field">
              <label className="diff-field-label" htmlFor="diff-left">
                Base version
              </label>
              <div className="diff-select-control">
                <select
                  id="diff-left"
                  className="search-input diff-version-select"
                  value={leftVersionId ?? ""}
                  onChange={(event) => setLeftVersionId(event.target.value as Id<"skillVersions">)}
                >
                  <option value="" disabled>
                    Select base version
                  </option>
                  {renderOptions(versionOptions)}
                </select>
                <ChevronDown className="diff-select-chevron" size={16} aria-hidden="true" />
              </div>
            </div>
            <Button
              className="diff-swap"
              type="button"
              size="icon-sm"
              variant="secondary"
              aria-label="Swap base and target versions"
              title="Swap base and target versions"
              onClick={() => {
                setLeftVersionId(rightVersionId);
                setRightVersionId(leftVersionId);
              }}
              disabled={!leftVersionId || !rightVersionId}
            >
              <ArrowLeftRight size={14} aria-hidden="true" />
            </Button>
            <div className="diff-field">
              <label className="diff-field-label" htmlFor="diff-right">
                Target version
              </label>
              <div className="diff-select-control">
                <select
                  id="diff-right"
                  className="search-input diff-version-select"
                  value={rightVersionId ?? ""}
                  onChange={(event) => setRightVersionId(event.target.value as Id<"skillVersions">)}
                >
                  <option value="" disabled>
                    Select target version
                  </option>
                  {renderOptions(versionOptions)}
                </select>
                <ChevronDown className="diff-select-chevron" size={16} aria-hidden="true" />
              </div>
            </div>
          </div>
          <div className="diff-field diff-view-field">
            <span className="diff-field-label">View</span>
            <fieldset className="diff-toggle-group">
              <legend className="sr-only">Diff layout</legend>
              <button
                className={`diff-toggle${viewMode === "split" ? " is-active" : ""}`}
                type="button"
                aria-pressed={viewMode === "split"}
                onClick={() => updateViewMode("split")}
              >
                <Columns2 size={14} aria-hidden="true" />
                Side-by-side
              </button>
              <button
                className={`diff-toggle${viewMode === "inline" ? " is-active" : ""}`}
                type="button"
                aria-pressed={viewMode === "inline"}
                onClick={() => updateViewMode("inline")}
              >
                <AlignJustify size={14} aria-hidden="true" />
                Inline
              </button>
            </fieldset>
          </div>
        </div>
      ) : null}

      <div className="diff-layout">
        {reviewFileItems.length > 0 ? (
          <div className="diff-file-select-wrap">
            <div className="diff-file-review-bar">
              <div
                className={`diff-file-navigation${hasMultipleReviewFiles ? " has-multiple-files" : ""}`}
              >
                {hasMultipleReviewFiles ? (
                  <button
                    type="button"
                    className="diff-review-icon-button"
                    aria-label="Previous file"
                    title="Previous file"
                    disabled={!canSelectPreviousFile}
                    onClick={() => selectRelativeFile(-1)}
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                ) : null}
                <div className="diff-select-control diff-file-select-control">
                  <select
                    id="diff-file"
                    className="search-input diff-file-select"
                    aria-label="File"
                    value={selectedPath ?? ""}
                    onChange={(event) => setSelectedPath(event.target.value)}
                  >
                    {reviewFileItems.map((item) => (
                      <option key={item.path} value={item.path}>
                        {item.path}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="diff-select-chevron" size={16} aria-hidden="true" />
                </div>
                {hasMultipleReviewFiles ? (
                  <button
                    type="button"
                    className="diff-review-icon-button"
                    aria-label="Next file"
                    title="Next file"
                    disabled={!canSelectNextFile}
                    onClick={() => selectRelativeFile(1)}
                  >
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <div className="diff-file-review-context">
                {selectedItem ? (
                  <span className={`diff-pill diff-pill-${selectedItem.status}`}>
                    {FILE_STATUS_LABELS[selectedItem.status]}
                  </span>
                ) : null}
                {selectedItem &&
                selectedItem.status !== "same" &&
                !isLoading &&
                diffStats.hunks > 0 ? (
                  <span
                    className="diff-line-stats"
                    aria-label={`${diffStats.additions} additions and ${diffStats.deletions} deletions`}
                  >
                    <span className="diff-line-additions">+{diffStats.additions}</span>
                    <span className="diff-line-deletions">-{diffStats.deletions}</span>
                  </span>
                ) : null}
              </div>
              <div className="diff-file-review-actions">
                {selectedReviewIndex >= 0 ? (
                  <span className="diff-file-count">
                    {selectedReviewIndex + 1} of {reviewFileItems.length} files
                  </span>
                ) : null}
                {diffStats.hunks > 1 ? (
                  <span className="diff-hunk-navigation">
                    <button
                      type="button"
                      className="diff-review-icon-button"
                      aria-label="Previous change"
                      title="Previous change"
                      onClick={() => diffEditorRef.current?.goToDiff("previous")}
                    >
                      <ArrowUp size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="diff-review-icon-button"
                      aria-label="Next change"
                      title="Next change"
                      onClick={() => diffEditorRef.current?.goToDiff("next")}
                    >
                      <ArrowDown size={15} aria-hidden="true" />
                    </button>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        <div className="diff-view">
          {error ? (
            <div className="diff-empty">{error}</div>
          ) : previewWarning ? (
            <div className="diff-empty">
              {previewWarning.side === "left" ? "Base" : "Target"} file is download-only and cannot
              be compared as text: {previewWarning.path}
            </div>
          ) : sizeWarning ? (
            <div className="diff-empty">
              {sizeWarning.side === "left" ? "Left" : "Right"} file exceeds 200KB:{" "}
              {sizeWarning.path}
            </div>
          ) : diffUnavailable ? (
            <div className="diff-empty">Publish another version to view a diff.</div>
          ) : !selectionReady ? (
            <div className="diff-empty">Select two versions.</div>
          ) : !fileSelected ? (
            <div className="diff-empty">Select a file.</div>
          ) : monacoError ? (
            <div className="diff-empty">{monacoError}</div>
          ) : !monacoReady || isLoading ? (
            <DiffViewerLoading />
          ) : (
            <ClientOnly fallback={<DiffViewerLoading />}>
              <DiffEditor
                className={`diff-monaco diff-monaco-${viewMode}`}
                original={leftText}
                modified={rightText}
                theme={getMonacoThemeName()}
                options={diffOptions}
                onMount={handleDiffMount}
              />
            </ClientOnly>
          )}
        </div>
      </div>
    </div>
  );
}

function renderOptions(options: VersionOption[]) {
  const groups: Record<VersionOption["group"], VersionOption[]> = {
    Special: [],
    Tags: [],
    Versions: [],
  };
  for (const option of options) {
    groups[option.group].push(option);
  }
  return (["Special", "Tags", "Versions"] as const)
    .filter((group) => groups[group].length > 0)
    .map((group) => (
      <optgroup key={group} label={group}>
        {groups[group].map((option) => (
          <option key={`${group}-${option.value}`} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </optgroup>
    ));
}

function getMonacoThemeName() {
  if (typeof document === "undefined") return "clawhub-light";
  return isDarkThemeResolved() ? "clawhub-dark" : "clawhub-light";
}

function buildDiffOptions(
  viewMode: "split" | "inline",
  isCompact: boolean,
): DiffEditorProps["options"] {
  const fontSize = isCompact ? 12 : 13;
  return {
    readOnly: true,
    renderSideBySide: viewMode === "split",
    useInlineViewWhenSpaceIsLimited: false,
    wordWrap: "on",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    overviewRulerBorder: false,
    renderOverviewRuler: true,
    renderIndicators: true,
    diffAlgorithm: "advanced",
    fontFamily: "var(--font-mono)",
    fontSize,
    lineHeight: Math.round(fontSize * 1.6),
  };
}

function applyMonacoTheme(monaco: NonNullable<ReturnType<typeof useMonaco>>) {
  const styles = getComputedStyle(document.documentElement);
  const isDark = isDarkThemeResolved();
  const surface = monacoColor(styles.getPropertyValue("--oc-bg-elevated"), "#ffffff");
  const surfaceMuted = monacoColor(styles.getPropertyValue("--oc-bg-surface"), "#f6f1ec");
  const ink = monacoColor(
    styles.getPropertyValue("--oc-text-primary"),
    isDark ? "#fafafa" : "#1d1a17",
  );
  const inkSoft = monacoColor(
    styles.getPropertyValue("--oc-text-secondary"),
    isDark ? "#d4d4d4" : "#4c463f",
  );
  const line = monacoColor(styles.getPropertyValue("--oc-border-subtle"), "rgba(29, 26, 23, 0.12)");
  const accent = monacoColor(styles.getPropertyValue("--oc-accent-primary"), "#e65c46");
  const seafoam = monacoColor(styles.getPropertyValue("--oc-accent-secondary"), "#2bc6a4");
  const diffAdded = monacoColor(styles.getPropertyValue("--oc-diff-added"), "#9bb955");
  const diffAddedStrong = monacoColor(styles.getPropertyValue("--oc-diff-added-strong"), seafoam);
  const diffRemoved = monacoColor(styles.getPropertyValue("--oc-diff-removed"), "#e47866");
  const diffRemovedStrong = monacoColor(
    styles.getPropertyValue("--oc-diff-removed-strong"),
    accent,
  );
  const diffDiagonal = toMonacoColor(
    monacoColor(styles.getPropertyValue("--diff-diagonal"), "#22222233"),
  );
  const diffBorder = toMonacoColor(monacoColor(styles.getPropertyValue("--diff-border"), line));
  const lineNumber = monacoColor(
    styles.getPropertyValue("--diff-line-number").trim() || styles.getPropertyValue("--ink-soft"),
    "#4c463f",
  );
  const background = surface;
  const gutter = surfaceMuted;
  const base = isDark ? "vs-dark" : "vs";

  const diffInserted = withAlpha(diffAdded, isDark ? 0.26 : 0.14);
  const diffInsertedText = withAlpha(diffAddedStrong, isDark ? 0.3 : 0.16);
  const diffInsertedBorder = withAlpha(diffAddedStrong, isDark ? 0.45 : 0.32);
  const diffRemovedBg = withAlpha(diffRemoved, isDark ? 0.26 : 0.12);
  const diffRemovedText = withAlpha(diffRemovedStrong, isDark ? 0.28 : 0.14);
  const diffRemovedBorder = withAlpha(diffRemovedStrong, isDark ? 0.45 : 0.28);
  const overviewInserted = withAlpha(diffAddedStrong, isDark ? 0.55 : 0.4);
  const overviewRemoved = withAlpha(diffRemovedStrong, isDark ? 0.55 : 0.4);

  monaco.editor.defineTheme(`clawhub-${isDark ? "dark" : "light"}`, {
    base,
    inherit: true,
    rules: [
      { token: "", foreground: normalizeHex(ink) },
      { token: "comment", foreground: normalizeHex(inkSoft) },
    ],
    colors: {
      "editor.background": background,
      "editor.foreground": ink,
      "editorLineNumber.foreground": lineNumber,
      "editorLineNumber.activeForeground": withAlpha(ink, isDark ? 0.72 : 0.85),
      "editorGutter.background": gutter,
      "editor.selectionBackground": toRgba(accent, 0.18),
      "editor.inactiveSelectionBackground": toRgba(accent, 0.12),
      "editorWidget.background": surface,
      "editorWidget.border": line,
      "editorWidget.foreground": ink,
      "diffEditor.insertedTextBackground": diffInsertedText,
      "diffEditor.removedTextBackground": diffRemovedText,
      "diffEditor.insertedLineBackground": diffInserted,
      "diffEditor.removedLineBackground": diffRemovedBg,
      "diffEditor.insertedTextBorder": diffInsertedBorder,
      "diffEditor.removedTextBorder": diffRemovedBorder,
      "diffEditorGutter.insertedLineBackground": diffInserted,
      "diffEditorGutter.removedLineBackground": diffRemovedBg,
      "diffEditorOverview.insertedForeground": overviewInserted,
      "diffEditorOverview.removedForeground": overviewRemoved,
      "diffEditor.diagonalFill": diffDiagonal,
      "diffEditor.border": diffBorder,
      "scrollbarSlider.background": toRgba(inkSoft, isDark ? 0.22 : 0.15),
      "scrollbarSlider.hoverBackground": toRgba(inkSoft, isDark ? 0.34 : 0.28),
      "scrollbarSlider.activeBackground": toRgba(inkSoft, isDark ? 0.46 : 0.4),
    },
  });

  monaco.editor.setTheme(`clawhub-${isDark ? "dark" : "light"}`);
}

function normalizeHex(value: string) {
  if (!value.startsWith("#")) return value;
  if (value.length === 4) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  return value;
}

function toRgba(color: string, alpha: number) {
  const hex = normalizeHex(color).replace("#", "");
  if (hex.length !== 6) return color;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function withAlpha(color: string, alpha: number) {
  const hex = normalizeHex(color);
  if (!hex.startsWith("#")) return color;
  const value = hex.slice(1);
  if (value.length !== 6) return color;
  const channel = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${value}${channel}`;
}

function toMonacoColor(color: string) {
  const trimmed = color.trim();
  if (trimmed.startsWith("#")) return trimmed;
  const rgbaMatch = /^rgba?\(([^)]+)\)$/i.exec(trimmed);
  if (!rgbaMatch) return trimmed;
  const parts = rgbaMatch[1].split(",").map((part) => part.trim());
  if (parts.length < 3) return trimmed;
  const [r, g, b] = parts.map((part) => Number.parseFloat(part));
  const alpha = parts.length >= 4 ? Number.parseFloat(parts[3]) : 1;
  if ([r, g, b, alpha].some((value) => Number.isNaN(value))) return trimmed;
  const channel = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${[r, g, b]
    .map((value) => Math.round(value).toString(16).padStart(2, "0"))
    .join("")}${channel}`;
}

// Monaco's theme parsers reject CSS Color 4 functions such as oklch() and lab(),
// which the Carapace themes write into the --oc-* tokens this component reads
// (#3440). monacoColor resolves a token to a Monaco-safe #hex color and swaps in
// the fallback when the syntax is unknown, so defineTheme() never sees a value
// it cannot parse.
function monacoColor(rawValue: string, fallback: string): string {
  const value = rawValue.trim();
  if (!value) return fallback;
  const hex = normalizeHex(value);
  if (hex.startsWith("#")) return hex;
  const rgbHex = toMonacoColor(value);
  if (rgbHex.startsWith("#")) return rgbHex;
  return cssColor4ToHex(value) ?? fallback;
}

type LinearSrgb = { r: number; g: number; b: number };

// Converts a lab(), lch(), oklab() or oklch() color to #rrggbb (or #rrggbbaa
// when it carries an alpha). Returns null for anything else so callers can
// fall back instead of forwarding an unparseable value to Monaco.
export function cssColor4ToHex(value: string): string | null {
  const match = /^(ok)?(lab|lch)\(([^)]+)\)$/i.exec(value.trim());
  if (!match) return null;
  const isOk = Boolean(match[1]);
  const isPolar = match[2].toLowerCase() === "lch";
  const [componentsRaw, alphaRaw] = match[3].split("/");
  const parts = componentsRaw.trim().split(/\s+/);
  if (parts.length !== 3) return null;

  // Percentages resolve per CSS Color 4: lightness against 100 (lab) or 1
  // (oklab), a/b against 125 (lab) or 0.4 (oklab), chroma against 150 (lch)
  // or 0.4 (oklch).
  const lightness = parseColor4Component(parts[0], isOk ? 1 : 100);
  const second = parseColor4Component(parts[1], isPolar ? (isOk ? 0.4 : 150) : isOk ? 0.4 : 125);
  if (lightness === null || second === null) return null;

  let a: number;
  let b: number;
  if (isPolar) {
    const hue = parseHue(parts[2]);
    if (hue === null) return null;
    a = second * Math.cos((hue * Math.PI) / 180);
    b = second * Math.sin((hue * Math.PI) / 180);
  } else {
    const third = parseColor4Component(parts[2], isOk ? 0.4 : 125);
    if (third === null) return null;
    a = second;
    b = third;
  }

  let alpha = 1;
  if (alphaRaw !== undefined) {
    const parsedAlpha = parseColor4Component(alphaRaw, 1);
    if (parsedAlpha === null) return null;
    alpha = Math.min(1, Math.max(0, parsedAlpha));
  }

  const rgb = isOk ? oklabToLinearSrgb(lightness, a, b) : labToLinearSrgb(lightness, a, b);
  const hex = `#${linearToSrgbHex(rgb.r)}${linearToSrgbHex(rgb.g)}${linearToSrgbHex(rgb.b)}`;
  if (alpha >= 1) return hex;
  return `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

function parseColor4Component(raw: string, percentScale: number): number | null {
  const value = raw.trim();
  if (value === "none") return 0;
  if (value.endsWith("%")) {
    const parsed = Number.parseFloat(value.slice(0, -1));
    return Number.isNaN(parsed) ? null : (parsed / 100) * percentScale;
  }
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseHue(raw: string): number | null {
  const value = raw.trim();
  if (value === "none") return 0;
  // Only plain degrees are resolved; turn/rad/grad fall back rather than
  // converting with the wrong unit.
  if (/[a-z%]/i.test(value) && !/deg$/i.test(value)) return null;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function oklabToLinearSrgb(lightness: number, a: number, b: number): LinearSrgb {
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541729 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186149 * m + 1.707614701 * s,
  };
}

function labToLinearSrgb(lightness: number, a: number, b: number): LinearSrgb {
  const fy = (lightness + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const delta = 6 / 29;
  const toXyz = (f: number) => (f > delta ? f ** 3 : 3 * delta * delta * (f - 4 / 29));
  // Lab is defined against the D50 white point.
  const x = toXyz(fx) * 0.96422;
  const y = toXyz(fy);
  const z = toXyz(fz) * 0.82521;
  // Bradford chromatic adaptation from D50 to sRGB's D65.
  const xd = 0.9555766 * x - 0.0230393 * y + 0.0631636 * z;
  const yd = -0.0282895 * x + 1.0099416 * y + 0.0210077 * z;
  const zd = 0.0122982 * x - 0.020483 * y + 1.3299098 * z;
  return {
    r: 3.2404542 * xd - 1.5371385 * yd - 0.4985314 * zd,
    g: -0.969266 * xd + 1.8760108 * yd + 0.041556 * zd,
    b: 0.0556434 * xd - 0.2040259 * yd + 1.0572252 * zd,
  };
}

function linearToSrgbHex(channel: number): string {
  const clamped = Math.min(1, Math.max(0, channel));
  const srgb = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255)
    .toString(16)
    .padStart(2, "0");
}
