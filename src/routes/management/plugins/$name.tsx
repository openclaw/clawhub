import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { ManagementAccessNotice } from "../../../components/ManagementAccessNotice";
import { PluginOperationsNav } from "../../../components/PluginOperationsNav";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { familyLabel } from "../../../lib/packageLabels";
import type { PublicPublisher } from "../../../lib/publicUser";
import { isModerator } from "../../../lib/roles";
import { useAuthStatus } from "../../../lib/useAuthStatus";

const packageApiRefs = api as unknown as {
  packages: {
    getByNameForStaff: unknown;
    setModerationVerdict: unknown;
    revokeStorePackArtifact: unknown;
  };
};

type PackageScanStatus = "clean" | "suspicious" | "malicious" | "pending" | "not-run";

type PluginByNameResult = {
  package: Doc<"packages">;
  latestRelease: Doc<"packageReleases"> | null;
  owner: PublicPublisher | null;
  highlighted: { byUserId: Id<"users">; at: number } | null;
} | null;

export const Route = createFileRoute("/management/plugins/$name")({
  component: PluginManagementDetailRoute,
});

function PluginManagementDetailRoute() {
  const { name } = Route.useParams();
  return <PluginManagementDetailPage name={name} />;
}

export function PluginManagementDetailPage({ name }: { name: string }) {
  const { me } = useAuthStatus();
  const staff = isModerator(me);
  const detail = useQuery(
    packageApiRefs.packages.getByNameForStaff as never,
    staff ? ({ name } as never) : "skip",
  ) as PluginByNameResult | undefined;
  const setPackageBatch = useMutation(api.packages.setBatch);
  const setModerationVerdict = useMutation(
    packageApiRefs.packages.setModerationVerdict as never,
  ) as unknown as (args: {
    packageId: Id<"packages">;
    verdict: PackageScanStatus;
    note?: string;
  }) => Promise<unknown>;
  const revokeClawPackArtifact = useMutation(
    packageApiRefs.packages.revokeStorePackArtifact as never,
  ) as unknown as (args: { releaseId: Id<"packageReleases">; reason?: string }) => Promise<unknown>;

  const [verdict, setVerdict] = useState<PackageScanStatus>("clean");
  const [note, setNote] = useState("");
  const [activeWrite, setActiveWrite] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plugin = detail?.package ?? null;
  const release = detail?.latestRelease ?? null;
  const owner = detail?.owner ?? null;
  const highlighted = Boolean(detail?.highlighted);

  useEffect(() => {
    if (plugin?.scanStatus) setVerdict(plugin.scanStatus as PackageScanStatus);
  }, [plugin?.scanStatus]);

  if (!staff) {
    return <ManagementAccessNotice me={me} />;
  }

  const saveVerdict = () => {
    if (!plugin) return;
    const trimmed = note.trim();
    if (!trimmed) {
      setError("Audit note required.");
      return;
    }
    if (
      !window.confirm(
        `Set ${plugin.name} moderation verdict to ${verdict}?\n\nThis writes a package moderation verdict and audit log in Convex.`,
      )
    ) {
      return;
    }
    setError(null);
    setActiveWrite("verdict");
    void setModerationVerdict({ packageId: plugin._id, verdict, note: trimmed })
      .then(() => setNote(""))
      .catch((requestError) => setError(formatMutationError(requestError)))
      .finally(() => setActiveWrite(null));
  };

  const toggleHighlight = () => {
    if (!plugin) return;
    const nextState = highlighted ? "remove highlighted badge from" : "mark highlighted for";
    if (
      !window.confirm(
        `This will ${nextState} ${plugin.name}.\n\nThis writes package badge state in Convex.`,
      )
    ) {
      return;
    }
    setError(null);
    setActiveWrite("highlight");
    void setPackageBatch({
      packageId: plugin._id,
      batch: highlighted ? undefined : "highlighted",
    })
      .catch((requestError) => setError(formatMutationError(requestError)))
      .finally(() => setActiveWrite(null));
  };

  const revokeClawPack = () => {
    if (!plugin || !release?._id) return;
    const reason = window.prompt(
      `Revoke Claw Pack for ${plugin.name}@${release.version}. Reason required.`,
    );
    const trimmed = reason?.trim();
    if (!trimmed) return;
    if (
      !window.confirm(
        `Revoke Claw Pack artifact for ${plugin.name}@${release.version}?\n\nThis writes revocation metadata and an audit log in Convex.`,
      )
    ) {
      return;
    }
    setError(null);
    setActiveWrite("clawpack");
    void revokeClawPackArtifact({ releaseId: release._id, reason: trimmed })
      .catch((requestError) => setError(formatMutationError(requestError)))
      .finally(() => setActiveWrite(null));
  };

  return (
    <main className="section">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="section-title">Plugin package detail</h1>
          <p className="section-subtitle">
            Staff drilldown for release provenance, Claw Pack artifact state, moderation verdicts,
            and package promotion controls.
          </p>
        </div>
        <div className="management-actions">
          <Button asChild variant="outline" size="sm">
            <Link to="/management/plugins" search={{ skill: undefined, plugin: undefined }}>
              Plugin index
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/management" search={{ skill: undefined, plugin: name }}>
              Legacy panel
            </Link>
          </Button>
        </div>
      </div>

      <PluginOperationsNav current="plugins" />

      {detail === undefined ? (
        <Card>Loading plugin package...</Card>
      ) : !plugin ? (
        <Card>No plugin package found for "{name}".</Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
                    {plugin.displayName}
                  </h2>
                  <Badge variant={scanBadgeVariant(plugin.scanStatus as PackageScanStatus)}>
                    {plugin.scanStatus}
                  </Badge>
                  {plugin.isOfficial ? <Badge variant="compact">official</Badge> : null}
                  {plugin.executesCode ? <Badge variant="compact">executes code</Badge> : null}
                  {highlighted ? <Badge variant="success">highlighted</Badge> : null}
                </div>
                <p className="section-subtitle m-0">{plugin.summary ?? "No summary provided."}</p>
                <div className="management-sublist">
                  <ReportField label="package" value={plugin.name} mono />
                  <ReportField
                    label="owner"
                    value={owner?.handle ? `@${owner.handle}` : "unknown"}
                  />
                  <ReportField
                    label="family"
                    value={`${familyLabel(plugin.family)} / ${plugin.channel}`}
                  />
                  <ReportField label="runtime id" value={plugin.runtimeId ?? "none"} mono />
                  <ReportField label="verification" value={plugin.verification?.tier ?? "none"} />
                  <ReportField label="updated" value={formatTimestamp(plugin.updatedAt)} />
                  <ReportField
                    label="latest release"
                    value={
                      release
                        ? `${release.version} / ${formatTimestamp(release.createdAt)}`
                        : "none"
                    }
                  />
                </div>
              </div>
              <div className="management-actions management-action-grid">
                <Button asChild className="management-action-btn" size="sm">
                  <Link to="/plugins/$name" params={{ name: plugin.name }}>
                    Public page
                  </Link>
                </Button>
                {release?.version ? (
                  <Button asChild className="management-action-btn" size="sm" variant="outline">
                    <Link
                      to="/plugins/$name/releases/$version"
                      params={{ name: plugin.name, version: release.version }}
                    >
                      Release page
                    </Link>
                  </Button>
                ) : null}
                <Button
                  className="management-action-btn"
                  loading={activeWrite === "highlight"}
                  size="sm"
                  type="button"
                  onClick={toggleHighlight}
                >
                  {highlighted ? "Unhighlight" : "Highlight"}
                </Button>
              </div>
            </div>
          </Card>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
                Claw Pack
              </h2>
              <div className="management-sublist">
                <ReportField label="state" value={formatClawPackState(release)} />
                <ReportField
                  label="zip digest"
                  value={release?.storepackSha256 ?? "missing"}
                  mono={Boolean(release?.storepackSha256)}
                />
                <ReportField
                  label="manifest digest"
                  value={release?.storepackManifestSha256 ?? "missing"}
                  mono={Boolean(release?.storepackManifestSha256)}
                />
                <ReportField
                  label="files"
                  value={release?.storepackFileCount ? String(release.storepackFileCount) : "none"}
                />
                <ReportField
                  label="size"
                  value={
                    release?.storepackSize ? formatBytesCompact(release.storepackSize) : "none"
                  }
                />
                <ReportField
                  label="host targets"
                  value={formatHostTargets(release?.hostTargetsSummary)}
                />
                <ReportField
                  label="environment"
                  value={formatEnvironmentSummary(release?.environmentSummary)}
                />
              </div>
              <Button
                className="self-start"
                disabled={!release?.storepackStorageId || Boolean(release.storepackRevokedAt)}
                loading={activeWrite === "storepack"}
                size="sm"
                type="button"
                variant="destructive"
                onClick={revokeClawPack}
              >
                Revoke Claw Pack
              </Button>
            </Card>

            <Card>
              <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
                Release provenance
              </h2>
              <div className="management-sublist">
                <ReportField label="source" value={formatReleaseSource(release?.source)} />
                <ReportField
                  label="verification scan"
                  value={release?.verification?.scanStatus ?? "missing"}
                />
                <ReportField label="static scan" value={release?.staticScan?.status ?? "missing"} />
                <ReportField label="VirusTotal" value={release?.vtAnalysis?.status ?? "missing"} />
                <ReportField label="LLM review" value={release?.llmAnalysis?.status ?? "missing"} />
              </div>
            </Card>
          </div>

          <Card className="mt-5">
            <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
              Moderation verdict
            </h2>
            <div className="management-tool-grid">
              <label className="management-control management-control-stack">
                <span className="mono">verdict</span>
                <select
                  className="management-field"
                  value={verdict}
                  onChange={(event) => setVerdict(event.target.value as PackageScanStatus)}
                >
                  <option value="clean">clean</option>
                  <option value="suspicious">suspicious</option>
                  <option value="malicious">malicious</option>
                  <option value="pending">pending</option>
                  <option value="not-run">not-run</option>
                </select>
              </label>
              <label className="management-control management-control-stack">
                <span className="mono">audit note</span>
                <input
                  className="management-field"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Required"
                />
              </label>
            </div>
            <div className="management-actions management-actions-start">
              <Button
                loading={activeWrite === "verdict"}
                type="button"
                disabled={!note.trim()}
                onClick={saveVerdict}
              >
                Save verdict
              </Button>
              {error ? <Badge variant="destructive">{error}</Badge> : null}
            </div>
          </Card>
        </>
      )}
    </main>
  );
}

function ReportField({ label, mono, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="management-report-item">
      <span className="management-report-meta">{label}</span>
      <span className={mono ? "mono break-all" : undefined}>{value}</span>
    </div>
  );
}

function scanBadgeVariant(status: PackageScanStatus) {
  if (status === "clean") return "success";
  if (status === "malicious") return "destructive";
  if (status === "suspicious") return "warning";
  return "pending";
}

function formatClawPackState(release: Doc<"packageReleases"> | null | undefined) {
  if (!release) return "no release";
  if (release.storepackRevokedAt) return `revoked ${formatTimestamp(release.storepackRevokedAt)}`;
  if (release.storepackStorageId)
    return `active ${formatTimestamp(release.storepackBuiltAt ?? release.createdAt)}`;
  return "missing";
}

function formatHostTargets(targets: Doc<"packageReleases">["hostTargetsSummary"]) {
  if (!targets?.length) return "No target summary yet";
  return targets
    .map((target) => [target.os, target.arch, target.libc].filter(Boolean).join("-"))
    .join(", ");
}

function formatEnvironmentSummary(environment: Doc<"packageReleases">["environmentSummary"]) {
  if (!environment) return "No environment summary yet";
  const labels = [
    environment.requiresLocalDesktop ? "desktop" : null,
    environment.requiresBrowser ? "browser" : null,
    environment.requiresAudioDevice ? "audio" : null,
    environment.requiresNetwork ? "network" : null,
    ...(environment.requiresExternalServices ?? []).map((service) => `service:${service}`),
    ...(environment.requiresOsPermissions ?? []).map((permission) => `permission:${permission}`),
  ].filter(Boolean);
  return labels.length > 0 ? labels.join(", ") : "No special environment requirements";
}

function formatReleaseSource(source: Doc<"packageReleases">["source"]) {
  if (!source || typeof source !== "object") return "missing";
  const typed = source as { repo?: string; ref?: string; path?: string; commit?: string };
  return (
    [typed.repo, typed.ref, typed.path, typed.commit?.slice(0, 12)].filter(Boolean).join(" / ") ||
    "missing"
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
