import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ManagementAccessNotice } from "../../components/ManagementAccessNotice";
import { PluginOperationsNav } from "../../components/PluginOperationsNav";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { deriveClawPackLifecycle } from "../../lib/packageLifecycle";
import { isAdmin, isModerator } from "../../lib/roles";
import { useAuthStatus } from "../../lib/useAuthStatus";

const packageApiRefs = api as unknown as {
  packages: {
    getStorePackMigrationStatus: unknown;
    dryRunStorePackMigrationRunForStaff: unknown;
    listStorePackMigrationRunsForStaff: unknown;
    startStorePackMigrationRun: unknown;
    continueStorePackMigrationRun: unknown;
  };
};

type ClawPackMigrationOperation = "artifact-backfill" | "failure-retry" | "search-index-backfill";

type ClawPackMigrationRunStatus = "pending" | "running" | "completed" | "failed";

type ClawPackMigrationStatus = {
  missingSample: Array<{
    releaseId: Id<"packageReleases">;
    packageId: Id<"packages">;
    name: string;
    displayName: string;
    version: string;
    createdAt: number;
    fileCount: number;
    storepackAvailable?: boolean;
    storepackBuiltAt?: number | null;
    storepackSha256?: string | null;
    storepackRevokedAt?: number | null;
  }>;
  failureSample: Array<{
    failureId: Id<"packageStorePackBackfillFailures">;
    releaseId: Id<"packageReleases">;
    packageId: Id<"packages">;
    name: string;
    version: string;
    error: string;
    attemptCount: number;
    firstFailedAt: number;
    lastAttemptAt: number;
    lastFailedAt: number;
  }>;
  missingSampleSize: number;
  failureSampleSize: number;
  generatedStorePackSampleSize: number;
  generatedStorePackBytes: number;
  sampleLimit: number;
};

type ClawPackBackfillResult = {
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

type ClawPackMigrationDryRunCandidate = {
  failureId?: Id<"packageStorePackBackfillFailures">;
  releaseId?: Id<"packageReleases">;
  packageId?: Id<"packages">;
  name?: string;
  displayName?: string;
  version?: string;
  error?: string;
  attemptCount?: number;
  lastFailedAt?: number;
  storepackSha256?: string | null;
  storepackBuiltAt?: number | null;
};

type ClawPackMigrationDryRun = {
  operation: ClawPackMigrationOperation;
  limit: number;
  cursor: string | null;
  continueCursor: string | null;
  isDone: boolean;
  candidates: ClawPackMigrationDryRunCandidate[];
  candidateCount: number;
  failureCount: number;
};

type ClawPackMigrationRun = {
  _id: Id<"storePackMigrationRuns">;
  actorUserId: Id<"users">;
  operation: ClawPackMigrationOperation;
  status: ClawPackMigrationRunStatus;
  limit: number;
  cursor?: string;
  continueCursor?: string;
  isDone?: boolean;
  processed: number;
  generated: number;
  skipped: number;
  failed: number;
  bytesGenerated: number;
  failureCounts: Record<string, number>;
  lastError?: string;
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
  actor?: {
    userId: Id<"users">;
    handle?: string | null;
    name?: string | null;
    role?: string | null;
  } | null;
};

type ClawPackMigrationRunList = {
  items: ClawPackMigrationRun[];
  limit: number;
  status: ClawPackMigrationRunStatus | null;
  hasMore: boolean;
};

type ClawPackMigrationRunResult = {
  run: ClawPackMigrationRun | null;
  result: ClawPackBackfillResult | null;
  error?: string;
};

export const Route = createFileRoute("/management/clawpacks")({
  component: ClawPackManagementRoute,
});

export function ClawPackManagementRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname !== "/management/clawpacks") return <Outlet />;
  return <ClawPackManagementConsole />;
}

function ClawPackManagementConsole() {
  const { me } = useAuthStatus();
  const staff = isModerator(me);
  const admin = isAdmin(me);
  const migration = useQuery(
    packageApiRefs.packages.getStorePackMigrationStatus as never,
    staff ? {} : "skip",
  ) as ClawPackMigrationStatus | undefined;
  const migrationRuns = useQuery(
    packageApiRefs.packages.listStorePackMigrationRunsForStaff as never,
    staff ? ({ limit: 12 } as never) : "skip",
  ) as ClawPackMigrationRunList | undefined;

  const [operation, setOperation] = useState<ClawPackMigrationOperation>("artifact-backfill");
  const [batchLimit, setBatchLimit] = useState(10);
  const [indexCursor, setIndexCursor] = useState("");
  const [dryRunArgs, setDryRunArgs] = useState<{
    operation: ClawPackMigrationOperation;
    limit: number;
    cursor?: string;
  } | null>(null);
  const dryRun = useQuery(
    packageApiRefs.packages.dryRunStorePackMigrationRunForStaff as never,
    staff && dryRunArgs ? (dryRunArgs as never) : "skip",
  ) as ClawPackMigrationDryRun | undefined;
  const startMigrationRun = useMutation(
    packageApiRefs.packages.startStorePackMigrationRun as never,
  ) as unknown as (args: {
    operation: ClawPackMigrationOperation;
    limit?: number;
    cursor?: string;
  }) => Promise<ClawPackMigrationRun | null>;
  const continueMigrationRun = useAction(
    packageApiRefs.packages.continueStorePackMigrationRun as never,
  ) as unknown as (args: {
    runId: Id<"storePackMigrationRuns">;
  }) => Promise<ClawPackMigrationRunResult>;
  const [lastResult, setLastResult] = useState<{
    kind: ClawPackMigrationOperation;
    result: ClawPackBackfillResult | null;
    run: ClawPackMigrationRun | null;
  } | null>(null);
  const [activeRunId, setActiveRunId] = useState<Id<"storePackMigrationRuns"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!staff) {
    return <ManagementAccessNotice me={me} />;
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
    setDryRunArgs({
      operation,
      limit,
      ...(operation === "search-index-backfill" && indexCursor.trim()
        ? { cursor: indexCursor.trim() }
        : {}),
    });
  };

  const createMigrationRun = () => {
    if (
      !window.confirm(
        `Create a ${formatOperation(operation)} migration run for up to ${limit} releases?\n\nThis writes an operator run record in Convex but does not execute the batch yet.`,
      )
    ) {
      return;
    }
    setError(null);
    void startMigrationRun({
      operation,
      limit,
      ...(operation === "search-index-backfill" && indexCursor.trim()
        ? { cursor: indexCursor.trim() }
        : {}),
    })
      .then((run) => {
        setLastResult({ kind: operation, result: null, run });
      })
      .catch((requestError) => setError(formatMutationError(requestError)));
  };

  const runMigrationBatch = (run: ClawPackMigrationRun) => {
    if (
      !window.confirm(
        `Run next ${formatOperation(run.operation)} batch?\n\nRun: ${run._id}\nLimit: ${run.limit}\nCursor: ${run.continueCursor ?? run.cursor ?? "start"}\n\nThis writes Claw Pack migration data in Convex.`,
      )
    ) {
      return;
    }
    setError(null);
    setActiveRunId(run._id);
    void continueMigrationRun({ runId: run._id })
      .then((result) => {
        setLastResult({
          kind: result.run?.operation ?? run.operation,
          result: result.result,
          run: result.run,
        });
        if (result.run?.continueCursor) setIndexCursor(result.run.continueCursor);
        if (result.error) setError(result.error);
      })
      .catch((requestError) => setError(formatMutationError(requestError)))
      .finally(() => setActiveRunId(null));
  };

  return (
    <main className="section">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="section-title">Claw Pack operations</h1>
          <p className="section-subtitle">
            Migration status, dry-run sampling, cursor resume, and rebuild controls for plugin Claw
            Pack artifacts.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/management" search={{ skill: undefined, plugin: undefined }}>
            Back to management
          </Link>
        </Button>
      </div>

      <PluginOperationsNav current="clawpacks" />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
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
          label="Open failures"
          value={migration ? String(migration.failureSampleSize) : "..."}
          detail="recent failed artifact builds"
        />
        <MetricCard
          label="Generated sample"
          value={migration ? String(migration.generatedStorePackSampleSize) : "..."}
          detail="sampled releases with artifacts"
        />
        <MetricCard
          label="Generated bytes"
          value={migration ? formatBytesCompact(migration.generatedStorePackBytes) : "..."}
          detail="stored Claw Pack sample size"
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
              <span className="mono">operation</span>
              <select
                className="management-field"
                value={operation}
                onChange={(event) => setOperation(event.target.value as ClawPackMigrationOperation)}
              >
                <option value="artifact-backfill">artifact backfill</option>
                <option value="failure-retry">failure retry</option>
                <option value="search-index-backfill">search index backfill</option>
              </select>
            </label>
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
              Dry-run operation
            </Button>
            {admin ? (
              <Button type="button" onClick={createMigrationRun}>
                Create migration run
              </Button>
            ) : null}
          </div>

          {error ? <Badge variant="accent">{error}</Badge> : null}
          {lastResult ? (
            <div className="management-report-item">
              <span className="management-report-meta">
                Last {formatOperation(lastResult.kind)}
              </span>
              {lastResult.result ? (
                <span>
                  processed {lastResult.result.processed ?? "?"} - succeeded{" "}
                  {lastResult.result.succeeded ?? "?"} - failed {lastResult.result.failed ?? "?"}
                  {lastResult.result.continueCursor
                    ? ` - next cursor ${lastResult.result.continueCursor}`
                    : ""}
                </span>
              ) : (
                <span>
                  created {lastResult.run?._id ?? "migration run"} with status{" "}
                  {lastResult.run?.status ?? "pending"}
                </span>
              )}
            </div>
          ) : null}
        </div>
      </Card>

      {dryRunArgs ? (
        <Card className="mt-5">
          <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
            Dry-run result
          </h2>
          {dryRun === undefined ? (
            <div className="stat mt-3">Loading dry-run candidates...</div>
          ) : (
            <DryRunResult result={dryRun} />
          )}
        </Card>
      ) : null}

      <Card className="mt-5">
        <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
          Migration runs
        </h2>
        {migrationRuns === undefined ? (
          <div className="stat mt-3">Loading migration run ledger...</div>
        ) : migrationRuns.items.length === 0 ? (
          <div className="stat mt-3">No Claw Pack migration runs have been created yet.</div>
        ) : (
          <MigrationRunRows
            rows={migrationRuns.items}
            admin={admin}
            activeRunId={activeRunId}
            onContinue={runMigrationBatch}
          />
        )}
      </Card>

      <Card className="mt-5">
        <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
          Missing artifacts
        </h2>
        {migration === undefined ? (
          <div className="stat mt-3">Loading Claw Pack migration status...</div>
        ) : migration.missingSample.length === 0 ? (
          <div className="stat mt-3">No missing Claw Pack artifacts in the current sample.</div>
        ) : (
          <MigrationRows rows={migration.missingSample} />
        )}
      </Card>

      <Card className="mt-5">
        <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
          Failed artifact builds
        </h2>
        {migration === undefined ? (
          <div className="stat mt-3">Loading failure ledger...</div>
        ) : migration.failureSample.length === 0 ? (
          <div className="stat mt-3">No open Claw Pack backfill failures in the sample.</div>
        ) : (
          <FailureRows rows={migration.failureSample} />
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

function MigrationRows(props: { rows: ClawPackMigrationStatus["missingSample"] }) {
  return (
    <div className="management-list mt-3">
      {props.rows.map((entry) => (
        <MigrationRow key={entry.releaseId} entry={entry} />
      ))}
    </div>
  );
}

function DryRunResult(props: { result: ClawPackMigrationDryRun }) {
  const result = props.result;
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div className="management-report-item">
        <span className="management-report-meta">operation</span>
        <span>
          {formatOperation(result.operation)} - {result.candidateCount} candidates
          {result.continueCursor ? ` - next cursor ${result.continueCursor}` : ""}
          {result.isDone ? " - done" : ""}
        </span>
      </div>
      {result.candidates.length === 0 ? (
        <div className="stat">No candidates found for this dry-run.</div>
      ) : (
        <div className="management-list">
          {result.candidates.map((candidate, index) => (
            <DryRunCandidateRow
              key={candidate.failureId ?? candidate.releaseId ?? `${result.operation}-${index}`}
              candidate={candidate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DryRunCandidateRow(props: { candidate: ClawPackMigrationDryRunCandidate }) {
  const candidate = props.candidate;
  const title = candidate.displayName ?? candidate.name ?? "Claw Pack candidate";
  return (
    <div className="management-item">
      <div className="management-item-main">
        <div className="flex flex-wrap items-center gap-2">
          {candidate.name ? (
            <Link to="/plugins/$name" params={{ name: candidate.name }}>
              {title}
            </Link>
          ) : (
            <strong>{title}</strong>
          )}
          {candidate.error ? <Badge variant="destructive">failed</Badge> : null}
        </div>
        <div className="section-subtitle m-0">
          {candidate.name ?? candidate.packageId ?? "package"}@{candidate.version ?? "unknown"}
          {candidate.attemptCount ? ` - ${candidate.attemptCount} attempts` : ""}
        </div>
        {candidate.error ? (
          <div className="management-report-item">
            <span className="management-report-meta">last error</span>
            <span>{candidate.error}</span>
          </div>
        ) : null}
      </div>
      {candidate.releaseId ? (
        <div className="management-actions">
          <Button asChild size="sm" variant="outline">
            <Link
              to="/management/clawpacks/releases/$releaseId"
              params={{ releaseId: candidate.releaseId }}
              search={{ skill: undefined, plugin: undefined }}
            >
              Details
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function MigrationRunRows(props: {
  rows: ClawPackMigrationRun[];
  admin: boolean;
  activeRunId: Id<"storePackMigrationRuns"> | null;
  onContinue: (run: ClawPackMigrationRun) => void;
}) {
  return (
    <div className="management-list mt-3">
      {props.rows.map((run) => (
        <MigrationRunRow
          key={run._id}
          run={run}
          admin={props.admin}
          active={props.activeRunId === run._id}
          onContinue={props.onContinue}
        />
      ))}
    </div>
  );
}

function MigrationRunRow(props: {
  run: ClawPackMigrationRun;
  admin: boolean;
  active: boolean;
  onContinue: (run: ClawPackMigrationRun) => void;
}) {
  const run = props.run;
  const canContinue = props.admin && run.status !== "completed" && run.status !== "running";
  return (
    <div className="management-item">
      <div className="management-item-main">
        <div className="flex flex-wrap items-center gap-2">
          <strong>{formatOperation(run.operation)}</strong>
          <Badge variant={run.status === "failed" ? "destructive" : "compact"}>{run.status}</Badge>
        </div>
        <div className="section-subtitle m-0">
          limit {run.limit} - processed {run.processed} - generated {run.generated} - skipped{" "}
          {run.skipped} - failed {run.failed}
        </div>
        <div className="section-subtitle m-0">
          created {formatTimestamp(run.createdAt)}
          {run.actor?.handle ? ` by @${run.actor.handle}` : ""}
          {run.continueCursor ? ` - next cursor ${run.continueCursor}` : ""}
        </div>
        {run.lastError ? (
          <div className="management-report-item">
            <span className="management-report-meta">last error</span>
            <span>{run.lastError}</span>
          </div>
        ) : null}
      </div>
      {canContinue ? (
        <div className="management-actions">
          <Button
            type="button"
            size="sm"
            onClick={() => props.onContinue(run)}
            disabled={props.active}
          >
            {props.active ? "Running..." : "Run next batch"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function MigrationRow(props: { entry: ClawPackMigrationStatus["missingSample"][number] }) {
  const entry = props.entry;
  const lifecycle = deriveClawPackLifecycle({
    available: entry.storepackAvailable ?? false,
    revokedAt: entry.storepackRevokedAt,
  });
  return (
    <div className="management-item">
      <div className="management-item-main">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/plugins/$name" params={{ name: entry.name }}>
            {entry.displayName}
          </Link>
          <Badge variant={lifecycle.severity === "danger" ? "destructive" : "accent"}>
            {lifecycle.label}
          </Badge>
        </div>
        <div className="section-subtitle m-0">
          {entry.name}@{entry.version} - {entry.fileCount} files - published{" "}
          {formatTimestamp(entry.createdAt)}
        </div>
        <div className="section-subtitle m-0">{lifecycle.action ?? lifecycle.description}</div>
      </div>
      <div className="management-actions">
        <Button asChild size="sm" variant="outline">
          <Link
            to="/management/clawpacks/releases/$releaseId"
            params={{ releaseId: entry.releaseId }}
            search={{ skill: undefined, plugin: undefined }}
          >
            Details
          </Link>
        </Button>
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
  );
}

function FailureRows(props: { rows: ClawPackMigrationStatus["failureSample"] }) {
  return (
    <div className="management-list mt-3">
      {props.rows.map((entry) => (
        <FailureRow key={entry.failureId} entry={entry} />
      ))}
    </div>
  );
}

function FailureRow(props: { entry: ClawPackMigrationStatus["failureSample"][number] }) {
  const entry = props.entry;
  const lifecycle = deriveClawPackLifecycle({
    available: false,
    buildError: entry.error,
  });
  return (
    <div className="management-item">
      <div className="management-item-main">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/plugins/$name" params={{ name: entry.name }}>
            {entry.name}@{entry.version}
          </Link>
          <Badge variant="destructive">{lifecycle.label}</Badge>
        </div>
        <div className="section-subtitle m-0">
          {entry.attemptCount} attempts - last failed {formatTimestamp(entry.lastFailedAt)}
        </div>
        <div className="management-report-item">
          <span className="management-report-meta">next action</span>
          <span>{lifecycle.action}</span>
        </div>
        <div className="management-report-item">
          <span className="management-report-meta">last error</span>
          <span>{entry.error}</span>
        </div>
      </div>
      <div className="management-actions">
        <Button asChild size="sm" variant="outline">
          <Link
            to="/management/clawpacks/releases/$releaseId"
            params={{ releaseId: entry.releaseId }}
            search={{ skill: undefined, plugin: undefined }}
          >
            Details
          </Link>
        </Button>
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

function formatOperation(value: ClawPackMigrationOperation) {
  return value.replaceAll("-", " ");
}

function formatMutationError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "Request failed.";
}
