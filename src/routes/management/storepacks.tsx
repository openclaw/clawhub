import { createFileRoute, Link } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { isAdmin, isModerator } from "../../lib/roles";
import { useAuthStatus } from "../../lib/useAuthStatus";

const packageApiRefs = api as unknown as {
  packages: {
    getStorePackMigrationStatus: unknown;
    backfillStorePackArtifacts: unknown;
    backfillStorePackSearchIndex: unknown;
  };
};

type StorePackMigrationStatus = {
  missingSample: Array<{
    releaseId: Id<"packageReleases">;
    packageId: Id<"packages">;
    name: string;
    displayName: string;
    version: string;
    createdAt: number;
    fileCount: number;
  }>;
  missingSampleSize: number;
  generatedStorePackSampleSize: number;
  generatedStorePackBytes: number;
  sampleLimit: number;
};

type StorePackBackfillResult = {
  processed?: number;
  succeeded?: number;
  failed?: number;
  skipped?: number;
  isDone?: boolean;
  continueCursor?: string | null;
  results?: Array<{
    ok?: boolean;
    name?: string;
    version?: string;
    error?: string;
    sha256?: string;
  }>;
};

export const Route = createFileRoute("/management/storepacks")({
  component: StorePackManagementRoute,
});

export function StorePackManagementRoute() {
  const { me } = useAuthStatus();
  const staff = isModerator(me);
  const admin = isAdmin(me);
  const migration = useQuery(
    packageApiRefs.packages.getStorePackMigrationStatus as never,
    staff ? {} : "skip",
  ) as StorePackMigrationStatus | undefined;
  const backfillStorePackArtifacts = useAction(
    packageApiRefs.packages.backfillStorePackArtifacts as never,
  ) as unknown as (args: { limit?: number }) => Promise<unknown>;
  const backfillStorePackSearchIndex = useAction(
    packageApiRefs.packages.backfillStorePackSearchIndex as never,
  ) as unknown as (args: { limit?: number; cursor?: string }) => Promise<unknown>;

  const [batchLimit, setBatchLimit] = useState(10);
  const [indexCursor, setIndexCursor] = useState("");
  const [dryRunRows, setDryRunRows] = useState<StorePackMigrationStatus["missingSample"]>([]);
  const [lastResult, setLastResult] = useState<{
    kind: "artifact-backfill" | "index-backfill";
    result: StorePackBackfillResult;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!staff) {
    return (
      <main className="section">
        <Card>Management only.</Card>
      </main>
    );
  }

  const limit = Math.max(1, Math.min(batchLimit, 100));
  const sampleTotal = migration
    ? migration.missingSampleSize + migration.generatedStorePackSampleSize
    : 0;
  const coverage =
    migration && sampleTotal > 0
      ? Math.round((migration.generatedStorePackSampleSize / sampleTotal) * 100)
      : null;

  const runDryRun = () => {
    setError(null);
    setDryRunRows((migration?.missingSample ?? []).slice(0, limit));
  };

  const runArtifactBackfill = () => {
    if (
      !window.confirm(
        `Build StorePack artifacts for up to ${limit} legacy releases?\n\nThis writes StorePack metadata in Convex.`,
      )
    ) {
      return;
    }
    setError(null);
    void backfillStorePackArtifacts({ limit })
      .then((result) => {
        setLastResult({ kind: "artifact-backfill", result: result as StorePackBackfillResult });
      })
      .catch((requestError) => setError(formatMutationError(requestError)));
  };

  const runIndexBackfill = () => {
    if (
      !window.confirm(
        `Rebuild StorePack search index rows for up to ${limit} releases?\n\nThis writes StorePack lookup rows in Convex.`,
      )
    ) {
      return;
    }
    setError(null);
    void backfillStorePackSearchIndex({
      limit,
      ...(indexCursor.trim() ? { cursor: indexCursor.trim() } : {}),
    })
      .then((result) => {
        const typedResult = result as StorePackBackfillResult;
        setLastResult({ kind: "index-backfill", result: typedResult });
        if (typedResult.continueCursor) setIndexCursor(typedResult.continueCursor);
      })
      .catch((requestError) => setError(formatMutationError(requestError)));
  };

  return (
    <main className="section">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="section-title">StorePack operations</h1>
          <p className="section-subtitle">
            Migration status, dry-run sampling, cursor resume, and rebuild controls for plugin
            StorePack artifacts.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/management">Back to management</Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          label="Sample coverage"
          value={coverage === null ? "unknown" : `${coverage}%`}
          detail={sampleTotal > 0 ? `${sampleTotal} sampled releases` : "No sample rows yet"}
        />
        <MetricCard
          label="Missing sample"
          value={migration ? String(migration.missingSampleSize) : "..."}
          detail="eligible releases without artifacts"
        />
        <MetricCard
          label="Generated sample"
          value={migration ? String(migration.generatedStorePackSampleSize) : "..."}
          detail="sampled releases with artifacts"
        />
        <MetricCard
          label="Generated bytes"
          value={migration ? formatBytesCompact(migration.generatedStorePackBytes) : "..."}
          detail="stored StorePack sample size"
        />
      </div>

      <Card className="mt-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
                Migration controls
              </h2>
              <p className="section-subtitle m-0">
                Dry-run reads from the current sample. Build and index actions require confirmation.
              </p>
            </div>
            <Badge variant="compact">{admin ? "admin write access" : "read only"}</Badge>
          </div>

          <div className="management-tool-grid">
            <label className="management-control management-control-stack">
              <span className="mono">batch limit</span>
              <input
                className="management-field"
                type="number"
                min={1}
                max={100}
                value={batchLimit}
                onChange={(event) => setBatchLimit(Number.parseInt(event.target.value, 10) || 1)}
              />
            </label>
            <label className="management-control management-control-stack">
              <span className="mono">index cursor</span>
              <input
                className="management-field"
                value={indexCursor}
                onChange={(event) => setIndexCursor(event.target.value)}
                placeholder="optional continue cursor"
              />
            </label>
          </div>

          <div className="management-actions management-actions-start">
            <Button type="button" variant="outline" onClick={runDryRun}>
              Dry-run sample
            </Button>
            {admin ? (
              <>
                <Button type="button" onClick={runArtifactBackfill}>
                  Build missing artifacts
                </Button>
                <Button type="button" onClick={runIndexBackfill}>
                  Rebuild lookup index
                </Button>
              </>
            ) : null}
          </div>

          {error ? <Badge variant="accent">{error}</Badge> : null}
          {lastResult ? (
            <div className="management-report-item">
              <span className="management-report-meta">
                Last {lastResult.kind.replace("-", " ")}
              </span>
              <span>
                processed {lastResult.result.processed ?? "?"} - succeeded{" "}
                {lastResult.result.succeeded ?? "?"} - failed {lastResult.result.failed ?? "?"}
                {lastResult.result.continueCursor
                  ? ` - next cursor ${lastResult.result.continueCursor}`
                  : ""}
              </span>
            </div>
          ) : null}
        </div>
      </Card>

      {dryRunRows.length > 0 ? (
        <Card className="mt-5">
          <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
            Dry-run sample
          </h2>
          <MigrationRows rows={dryRunRows} />
        </Card>
      ) : null}

      <Card className="mt-5">
        <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
          Missing artifacts
        </h2>
        {migration === undefined ? (
          <div className="stat mt-3">Loading StorePack migration status...</div>
        ) : migration.missingSample.length === 0 ? (
          <div className="stat mt-3">No missing StorePack artifacts in the current sample.</div>
        ) : (
          <MigrationRows rows={migration.missingSample} />
        )}
      </Card>
    </main>
  );
}

function MetricCard(props: { label: string; value: string; detail: string }) {
  return (
    <Card>
      <div className="management-report-item">
        <span className="management-report-meta">{props.label}</span>
        <strong className="text-[color:var(--ink)]">{props.value}</strong>
      </div>
      <p className="section-subtitle m-0 mt-2">{props.detail}</p>
    </Card>
  );
}

function MigrationRows(props: { rows: StorePackMigrationStatus["missingSample"] }) {
  return (
    <div className="management-list mt-3">
      {props.rows.map((entry) => (
        <div key={entry.releaseId} className="management-item">
          <div className="management-item-main">
            <Link to="/plugins/$name" params={{ name: entry.name }}>
              {entry.displayName}
            </Link>
            <div className="section-subtitle m-0">
              {entry.name}@{entry.version} - {entry.fileCount} files - published{" "}
              {formatTimestamp(entry.createdAt)}
            </div>
          </div>
          <div className="management-actions">
            <Button asChild size="sm" variant="outline">
              <Link to="/management" search={{ skill: undefined, plugin: entry.name }}>
                Manage
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link
                to="/plugins/$name/releases/$version"
                params={{ name: entry.name, version: entry.version }}
              >
                Release
              </Link>
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatBytesCompact(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0B";
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${(value / (1024 * 1024)).toFixed(1)}MB`;
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
}

function formatMutationError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "Request failed.";
}
