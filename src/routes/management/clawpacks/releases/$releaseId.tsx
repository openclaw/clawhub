import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { ManagementAccessNotice } from "../../../../components/ManagementAccessNotice";
import { PluginOperationsNav } from "../../../../components/PluginOperationsNav";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { deriveClawPackLifecycle } from "../../../../lib/packageLifecycle";
import { isModerator } from "../../../../lib/roles";
import { useAuthStatus } from "../../../../lib/useAuthStatus";

const packageApiRefs = api as unknown as {
  packages: {
    getClawPackReleaseForStaff: unknown;
  };
};

type ReleaseSourceSummary = {
  kind: string | null;
  repo: string | null;
  url: string | null;
  ref: string | null;
  commit: string | null;
  path: string | null;
} | null;

type ClawPackReleaseDetail = {
  package: {
    packageId: Id<"packages">;
    name: string;
    displayName: string;
    family: string;
    channel: string;
    isOfficial: boolean;
    scanStatus: string;
    updatedAt: number;
  };
  release: {
    releaseId: Id<"packageReleases">;
    version: string;
    createdAt: number;
    fileCount: number;
    fileSample: Array<{ path: string; size: number; sha256: string }>;
    clawpackStorageId: Id<"_storage"> | null;
    clawpackSha256: string | null;
    clawpackSize: number | null;
    clawpackSpecVersion: number | null;
    clawpackFormat: string | null;
    clawpackFileCount: number | null;
    clawpackManifestSha256: string | null;
    clawpackBuiltAt: number | null;
    clawpackBuildVersion: string | null;
    clawpackRevokedAt: number | null;
    clawpackRevocationReason: string | null;
    hostTargetsSummary: Array<{ os?: string; arch?: string; libc?: string }>;
    environmentSummary: {
      requiresLocalDesktop?: boolean;
      requiresBrowser?: boolean;
      requiresAudioDevice?: boolean;
      requiresNetwork?: boolean;
      requiresExternalServices?: string[];
      requiresOsPermissions?: string[];
    } | null;
    source: ReleaseSourceSummary;
    verificationScanStatus: string | null;
    vtStatus: string | null;
    vtVerdict: string | null;
    llmStatus: string | null;
    llmVerdict: string | null;
    staticScanStatus: string | null;
    staticScanSummary: string | null;
    staticScanReasonCodes: string[];
  };
  artifacts: Array<{
    artifactId: Id<"packageReleaseArtifacts">;
    kind: string;
    targetKey: string | null;
    storageId: Id<"_storage">;
    sha256: string;
    size: number;
    format: string;
    status: string;
    createdAt: number;
    revokedAt: number | null;
    revocationReason: string | null;
  }>;
  failures: Array<{
    failureId: Id<"packageClawPackBackfillFailures">;
    error: string;
    attemptCount: number;
    firstFailedAt: number;
    lastAttemptAt: number;
    lastFailedAt: number;
    resolvedAt: number | null;
  }>;
  searchIndexRows: Array<{
    rowId: Id<"packageClawPackSearchIndex">;
    kind: string;
    key: string;
    updatedAt: number;
    createdAt: number;
  }>;
} | null;

export const Route = createFileRoute("/management/clawpacks/releases/$releaseId")({
  component: ClawPackReleaseDetailRoute,
});

function ClawPackReleaseDetailRoute() {
  const { releaseId } = Route.useParams();
  return <ClawPackReleaseDetailPage releaseId={releaseId as Id<"packageReleases">} />;
}

export function ClawPackReleaseDetailPage(props: { releaseId: Id<"packageReleases"> }) {
  const { me } = useAuthStatus();
  const staff = isModerator(me);
  const detail = useQuery(
    packageApiRefs.packages.getClawPackReleaseForStaff as never,
    staff ? ({ releaseId: props.releaseId } as never) : "skip",
  ) as ClawPackReleaseDetail | undefined;

  if (!staff) {
    return <ManagementAccessNotice me={me} />;
  }

  return (
    <main className="section">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="section-title">Claw Pack release detail</h1>
          <p className="section-subtitle">
            Release-level artifact state, failure history, lookup rows, and provenance evidence.
          </p>
        </div>
        <div className="management-actions">
          <Button asChild variant="outline" size="sm">
            <Link to="/management/clawpacks" search={{ skill: undefined, plugin: undefined }}>
              Claw Pack ops
            </Link>
          </Button>
          {detail?.package ? (
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/management/plugins/$name"
                params={{ name: detail.package.name }}
                search={{ skill: undefined, plugin: undefined }}
              >
                Plugin detail
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <PluginOperationsNav current="clawpacks" />

      {detail === undefined ? (
        <Card>Loading Claw Pack release...</Card>
      ) : detail === null ? (
        <Card>No plugin release found for this Claw Pack record.</Card>
      ) : (
        <ClawPackReleaseDetailBody detail={detail} />
      )}
    </main>
  );
}

function ClawPackReleaseDetailBody(props: { detail: Exclude<ClawPackReleaseDetail, null> }) {
  const { detail } = props;
  const lifecycle = deriveClawPackLifecycle({
    available: Boolean(detail.release.clawpackStorageId),
    revokedAt: detail.release.clawpackRevokedAt ?? undefined,
    buildError: detail.failures[0]?.error,
  });
  return (
    <div className="grid gap-5">
      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 font-display text-2xl font-bold text-[color:var(--ink)]">
                {detail.package.displayName}
              </h2>
              <Badge variant={lifecycleBadgeVariant(lifecycle.severity)}>{lifecycle.label}</Badge>
              {detail.package.isOfficial ? <Badge variant="compact">official</Badge> : null}
              <Badge variant="compact">{detail.package.family}</Badge>
            </div>
            <p className="section-subtitle m-0">
              <span className="mono">{detail.package.name}</span>@{detail.release.version}
            </p>
          </div>
          <div className="management-actions management-action-grid">
            <Button asChild className="management-action-btn" size="sm">
              <Link to="/plugins/$name" params={{ name: detail.package.name }}>
                Public page
              </Link>
            </Button>
            <Button asChild className="management-action-btn" size="sm" variant="outline">
              <Link
                to="/plugins/$name/releases/$version"
                params={{ name: detail.package.name, version: detail.release.version }}
              >
                Release page
              </Link>
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="m-0 font-display text-lg font-bold text-[color:var(--ink)]">
            Claw Pack state
          </h3>
          <div className="management-sublist">
            <ReportField label="lifecycle" value={lifecycle.description} />
            <ReportField
              label="built"
              value={
                detail.release.clawpackBuiltAt
                  ? formatTimestamp(detail.release.clawpackBuiltAt)
                  : "missing"
              }
            />
            <ReportField label="format" value={detail.release.clawpackFormat ?? "missing"} />
            <ReportField
              label="zip digest"
              value={detail.release.clawpackSha256 ?? "missing"}
              mono={Boolean(detail.release.clawpackSha256)}
            />
            <ReportField
              label="manifest digest"
              value={detail.release.clawpackManifestSha256 ?? "missing"}
              mono={Boolean(detail.release.clawpackManifestSha256)}
            />
            <ReportField
              label="size"
              value={
                detail.release.clawpackSize
                  ? formatBytesCompact(detail.release.clawpackSize)
                  : "missing"
              }
            />
            <ReportField
              label="files"
              value={detail.release.clawpackFileCount?.toString() ?? "missing"}
            />
            <ReportField
              label="revocation"
              value={
                detail.release.clawpackRevokedAt
                  ? `${formatTimestamp(detail.release.clawpackRevokedAt)} - ${
                      detail.release.clawpackRevocationReason ?? "no reason"
                    }`
                  : "none"
              }
            />
          </div>
        </Card>

        <Card>
          <h3 className="m-0 font-display text-lg font-bold text-[color:var(--ink)]">
            Provenance and scans
          </h3>
          <div className="management-sublist">
            <ReportField label="source" value={formatSource(detail.release.source)} />
            <ReportField
              label="verification"
              value={detail.release.verificationScanStatus ?? "missing"}
            />
            <ReportField label="static scan" value={detail.release.staticScanStatus ?? "missing"} />
            <ReportField label="VirusTotal" value={detail.release.vtStatus ?? "missing"} />
            <ReportField label="LLM review" value={detail.release.llmStatus ?? "missing"} />
            <ReportField
              label="static reasons"
              value={
                detail.release.staticScanReasonCodes.length
                  ? detail.release.staticScanReasonCodes.join(", ")
                  : "none"
              }
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <EvidenceList
          title="Host targets"
          values={detail.release.hostTargetsSummary.map(formatHostTarget)}
          empty="No host target summary yet"
        />
        <EvidenceList
          title="Environment"
          values={formatEnvironmentSummary(detail.release.environmentSummary)}
          empty="No environment summary yet"
        />
      </div>

      <Card>
        <h3 className="m-0 font-display text-lg font-bold text-[color:var(--ink)]">
          Artifact rows
        </h3>
        <div className="management-list mt-3">
          {detail.artifacts.length ? (
            detail.artifacts.map((artifact) => (
              <div className="management-item" key={artifact.artifactId}>
                <div className="management-item-main">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={artifact.status === "active" ? "success" : "compact"}>
                      {artifact.status}
                    </Badge>
                    <span className="mono">{artifact.kind}</span>
                    {artifact.targetKey ? (
                      <Badge variant="compact">{artifact.targetKey}</Badge>
                    ) : null}
                  </div>
                  <div className="section-subtitle m-0">
                    {formatBytesCompact(artifact.size)} - {artifact.format} - created{" "}
                    {formatTimestamp(artifact.createdAt)}
                  </div>
                  <div className="mono break-all">{artifact.sha256}</div>
                </div>
              </div>
            ))
          ) : (
            <div className="stat">No artifact rows recorded for this release.</div>
          )}
        </div>
      </Card>

      <Card>
        <h3 className="m-0 font-display text-lg font-bold text-[color:var(--ink)]">
          Failure ledger
        </h3>
        <div className="management-list mt-3">
          {detail.failures.length ? (
            detail.failures.map((failure) => (
              <div className="management-item" key={failure.failureId}>
                <div className="management-item-main">
                  <div className="section-subtitle m-0">
                    {failure.attemptCount} attempts - last failed{" "}
                    {formatTimestamp(failure.lastFailedAt)}
                  </div>
                  <div className="management-report-item">
                    <span className="management-report-meta">error</span>
                    <span>{failure.error}</span>
                  </div>
                  <div className="management-report-item">
                    <span className="management-report-meta">resolved</span>
                    <span>{failure.resolvedAt ? formatTimestamp(failure.resolvedAt) : "open"}</span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="stat">No Claw Pack build failures recorded for this release.</div>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="m-0 font-display text-lg font-bold text-[color:var(--ink)]">
            Lookup index
          </h3>
          <div className="management-list mt-3">
            {detail.searchIndexRows.length ? (
              detail.searchIndexRows.map((row) => (
                <div className="management-report-item" key={row.rowId}>
                  <span className="management-report-meta">{row.kind}</span>
                  <span className="mono">{row.key}</span>
                </div>
              ))
            ) : (
              <div className="stat">No lookup rows for this release.</div>
            )}
          </div>
        </Card>

        <Card>
          <h3 className="m-0 font-display text-lg font-bold text-[color:var(--ink)]">
            Release files
          </h3>
          <p className="section-subtitle m-0 mt-2">
            Showing {detail.release.fileSample.length} of {detail.release.fileCount} files.
          </p>
          <div className="management-list mt-3">
            {detail.release.fileSample.map((file) => (
              <div className="management-report-item" key={file.path}>
                <span className="mono break-all">{file.path}</span>
                <span>{formatBytesCompact(file.size)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ReportField(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="management-report-item">
      <span className="management-report-meta">{props.label}</span>
      <span className={props.mono ? "mono break-all" : undefined}>{props.value}</span>
    </div>
  );
}

function EvidenceList(props: { title: string; values: string[]; empty: string }) {
  return (
    <Card>
      <h3 className="m-0 font-display text-lg font-bold text-[color:var(--ink)]">{props.title}</h3>
      <div className="management-sublist">
        {props.values.length ? (
          props.values.map((value) => (
            <div className="management-report-item" key={value}>
              <span>{value}</span>
            </div>
          ))
        ) : (
          <div className="stat">{props.empty}</div>
        )}
      </div>
    </Card>
  );
}

function lifecycleBadgeVariant(severity: string) {
  if (severity === "success") return "success";
  if (severity === "danger") return "destructive";
  if (severity === "warning") return "warning";
  return "compact";
}

function formatSource(source: ReleaseSourceSummary) {
  if (!source) return "missing";
  return (
    [source.repo ?? source.url, source.ref, source.path, source.commit?.slice(0, 12)]
      .filter(Boolean)
      .join(" / ") || "missing"
  );
}

function formatHostTarget(target: { os?: string; arch?: string; libc?: string }) {
  return [target.os, target.arch, target.libc].filter(Boolean).join("-") || "unknown";
}

function formatEnvironmentSummary(
  environment: Exclude<ClawPackReleaseDetail, null>["release"]["environmentSummary"],
) {
  if (!environment) return [];
  return [
    environment.requiresLocalDesktop ? "desktop" : null,
    environment.requiresBrowser ? "browser" : null,
    environment.requiresAudioDevice ? "audio" : null,
    environment.requiresNetwork ? "network" : null,
    ...(environment.requiresExternalServices ?? []).map((service) => `service:${service}`),
    ...(environment.requiresOsPermissions ?? []).map((permission) => `permission:${permission}`),
  ].filter((value): value is string => Boolean(value));
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
