import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import { MarketplaceIcon } from "../components/MarketplaceIcon";
import {
  getClawScanDisplayStatus,
  getScanStatusInfo,
  getVirusTotalDisplayStatus,
  ScanResultBadge,
  type LlmAnalysis,
  type VtAnalysis,
} from "../components/SkillSecurityScanResults";
import { convexHttp } from "../convex/client";
import {
  PLUGIN_NAV_ICON,
  SKILL_NAV_ICON,
  type MarketplaceIconComponent,
} from "../lib/marketplaceIcons";
import { formatCompactStat } from "../lib/numberFormat";

type AuditTarget = "skills" | "plugins";
type AuditFeedStatus = "loading" | "idle" | "loadingMore" | "done";

type SkillAuditRow = {
  kind: "skill";
  skill: {
    slug: string;
    displayName: string;
    summary?: string;
    icon?: string;
    stats: {
      downloads: number;
      installs?: number;
      stars: number;
    };
    updatedAt: number;
  };
  ownerHandle: string | null;
  latestVersion: {
    version: string;
    vtAnalysis?: VtAnalysis | null;
    llmAnalysis?: LlmAnalysis | null;
  } | null;
};

type PluginAuditRow = {
  kind: "plugin";
  package: {
    name: string;
    displayName: string;
    family: "code-plugin" | "bundle-plugin";
    channel: "official" | "community" | "private";
    isOfficial: boolean;
    summary: string | null;
    ownerHandle: string | null;
    latestVersion: string | null;
    stats: {
      downloads: number;
      installs: number;
      stars: number;
      versions: number;
    };
    updatedAt: number;
  };
  latestRelease: {
    version: string;
    vtAnalysis?: VtAnalysis | null;
    llmAnalysis?: LlmAnalysis | null;
  } | null;
};

type AuditRow = SkillAuditRow | PluginAuditRow;

type AuditsSearch = {
  type?: AuditTarget;
};

const AUDIT_PAGE_SIZE = 50;

export const Route = createFileRoute("/audits")({
  validateSearch: (search): AuditsSearch => ({
    type: search.type === "plugins" ? "plugins" : "skills",
  }),
  component: AuditsPage,
});

function isNavigationAbortError(err: unknown) {
  return err instanceof Error && (err.name === "AbortError" || err.message === "Failed to fetch");
}

function useAuditFeed(type: AuditTarget) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<AuditFeedStatus>("loading");
  const [error, setError] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const generationRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const fetchPage = useCallback(
    async (nextCursor: string | null, generation: number) => {
      try {
        const paginationOpts = {
          cursor: nextCursor,
          numItems: AUDIT_PAGE_SIZE,
        };
        const result =
          type === "skills"
            ? await convexHttp.query(api.skills.listAuditPage, { paginationOpts })
            : await convexHttp.query(api.packages.listAuditPage, { paginationOpts });
        if (generation !== generationRef.current) return;

        const page = result.page as AuditRow[];
        setRows((prev) => (nextCursor ? [...prev, ...page] : page));

        const next =
          "nextCursor" in result
            ? (result.nextCursor ?? null)
            : result.isDone
              ? null
              : result.continueCursor;
        setCursor(next);
        setStatus(next ? "idle" : "done");
        setError(false);
      } catch (err) {
        if (generation !== generationRef.current) return;
        if (!isNavigationAbortError(err)) {
          console.error("Failed to fetch audit page:", err);
        }
        setError(true);
        setStatus(nextCursor ? "idle" : "done");
      } finally {
        loadingMoreRef.current = false;
      }
    },
    [type],
  );

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setRows([]);
    setCursor(null);
    setError(false);
    setStatus("loading");
    void fetchPage(null, generation);
    return () => {
      generationRef.current += 1;
    };
  }, [fetchPage]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !cursor || status !== "idle") return () => {};
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting || loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        setStatus("loadingMore");
        void fetchPage(cursor, generationRef.current);
      },
      { rootMargin: "420px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, fetchPage, status]);

  return {
    rows,
    sentinelRef,
    status,
    error,
    canLoadMore: Boolean(cursor) && status === "idle",
    loadMore: () => {
      if (!cursor || loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      setStatus("loadingMore");
      void fetchPage(cursor, generationRef.current);
    },
  };
}

function itemHref(row: AuditRow) {
  if (row.kind === "plugin") return `/plugins/${encodeURIComponent(row.package.name)}`;
  const owner = row.ownerHandle?.trim() || "unknown";
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(row.skill.slug)}`;
}

function downloadsForRow(row: AuditRow) {
  return row.kind === "plugin" ? row.package.stats.downloads : row.skill.stats.downloads;
}

function AuditsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const type = search.type ?? "skills";
  const { rows, sentinelRef, status, error, canLoadMore, loadMore } = useAuditFeed(type);
  const isInitialLoading = status === "loading";
  const itemColumnLabel = type === "skills" ? "Skill" : "Plugin";

  const tabs = useMemo(
    () =>
      [
        { id: "skills" as const, label: "Skills", icon: SKILL_NAV_ICON },
        { id: "plugins" as const, label: "Plugins", icon: PLUGIN_NAV_ICON },
      ] satisfies Array<{ id: AuditTarget; label: string; icon: MarketplaceIconComponent }>,
    [],
  );

  return (
    <main className="browse-page audits-page">
      <div className="browse-page-header audits-page-header">
        <div>
          <h1 className="audits-title">Security Audits</h1>
          <p className="audits-subtitle">Latest security audits for skills and plugins</p>
        </div>
      </div>

      <div className="audits-table-toolbar">
        <div className="audits-tabs" role="tablist" aria-label="Audit target">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = type === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className="audits-tab"
                data-active={active ? "true" : "false"}
                onClick={() => {
                  void navigate({ search: { type: tab.id }, replace: true });
                }}
              >
                <Icon size={15} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <section className="audits-table-shell" aria-label={`${itemColumnLabel} security audits`}>
        <div className="audits-table" role="table">
          <div className="audits-table-row audits-table-head" role="row">
            <div role="columnheader">{itemColumnLabel}</div>
            <div role="columnheader">ClawScan</div>
            <div role="columnheader">VirusTotal</div>
            <div role="columnheader" className="audits-downloads-header">
              Downloads
            </div>
          </div>
          {isInitialLoading ? (
            <AuditSkeletonRows />
          ) : (
            rows.map((row) => <AuditTableRow key={`${row.kind}-${itemHref(row)}`} row={row} />)
          )}
        </div>
        {error ? (
          <p className="audits-error">Some audit rows could not load. Try again in a moment.</p>
        ) : null}
        <div ref={sentinelRef} className="audits-sentinel" aria-hidden="true" />
        {status === "loadingMore" ? <AuditSkeletonRows count={3} /> : null}
        {canLoadMore ? (
          <button type="button" className="button secondary audits-load-more" onClick={loadMore}>
            Load more
          </button>
        ) : null}
      </section>
    </main>
  );
}

function AuditTableRow({ row }: { row: AuditRow }) {
  const latest = row.kind === "plugin" ? row.latestRelease : row.latestVersion;
  const clawScanStatus = getClawScanDisplayStatus(latest?.llmAnalysis ?? null);
  const vtStatus = getVirusTotalDisplayStatus(latest?.vtAnalysis ?? null);
  const ownerHandle = row.kind === "plugin" ? row.package.ownerHandle : row.ownerHandle;
  const displayName = row.kind === "plugin" ? row.package.displayName : row.skill.displayName;
  const summary = row.kind === "plugin" ? row.package.summary : row.skill.summary;

  return (
    <div className="audits-table-row" role="row">
      <div role="cell" className="audits-item-cell">
        <MarketplaceIcon
          kind={row.kind}
          label={displayName}
          icon={row.kind === "skill" ? row.skill.icon : undefined}
          skill={row.kind === "skill" ? row.skill : null}
        />
        <div className="audits-item-copy">
          <Link to={itemHref(row)} className="audits-item-name">
            {ownerHandle ? <span>@{ownerHandle} / </span> : null}
            {displayName}
          </Link>
          {summary ? <p>{summary}</p> : null}
        </div>
      </div>
      <AuditSignalCell status={clawScanStatus} />
      <AuditSignalCell status={vtStatus} />
      <div role="cell" className="audits-downloads-cell">
        {formatCompactStat(downloadsForRow(row))}
      </div>
    </div>
  );
}

function AuditSignalCell({ status }: { status: string }) {
  const info = getScanStatusInfo(status);
  return (
    <div role="cell" className="audits-signal-cell">
      <ScanResultBadge status={status} label={info.label} />
    </div>
  );
}

function AuditSkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="audits-table-row audits-skeleton-row" role="row">
          <div role="cell" className="audits-item-cell">
            <span className="audits-skeleton-icon" />
            <span className="audits-skeleton-copy" />
          </div>
          <span className="audits-skeleton-pill" />
          <span className="audits-skeleton-pill" />
          <span className="audits-skeleton-stat" />
        </div>
      ))}
    </>
  );
}
