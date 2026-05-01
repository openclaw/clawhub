import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ManagementAccessNotice } from "../../components/ManagementAccessNotice";
import { PluginOperationsNav } from "../../components/PluginOperationsNav";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { familyLabel } from "../../lib/packageLabels";
import { isModerator } from "../../lib/roles";
import { useAuthStatus } from "../../lib/useAuthStatus";

const packageApiRefs = api as unknown as {
  packages: {
    listModerationQueueForStaff: unknown;
  };
};

type PackageScanStatus = "clean" | "suspicious" | "malicious" | "pending" | "not-run";
type QueueStatus = PackageScanStatus | "needs-review";

type PluginQueueItem = {
  packageId: Id<"packages">;
  name: string;
  displayName: string;
  family: "skill" | "code-plugin" | "bundle-plugin";
  channel: "official" | "community" | "private";
  isOfficial: boolean;
  ownerHandle?: string;
  summary?: string;
  latestVersion?: string;
  runtimeId?: string;
  executesCode?: boolean;
  verificationTier?: string;
  storepackAvailable?: boolean;
  hostTargetKeys: string[];
  environmentFlags: string[];
  scanStatus: PackageScanStatus;
  updatedAt: number;
  latestRelease: {
    releaseId: Id<"packageReleases">;
    version: string;
    createdAt: number;
    storepackAvailable: boolean;
    storepackRevokedAt?: number;
    storepackSha256?: string;
    storepackFileCount?: number;
    source: {
      repo: string | null;
      ref: string | null;
      path: string | null;
    } | null;
    verificationScanStatus: string | null;
  } | null;
};

type PluginQueueResult = {
  items: PluginQueueItem[];
  status: QueueStatus;
  limit: number;
  hasMore: boolean;
};

const QUEUE_STATUSES: Array<{ value: QueueStatus; label: string }> = [
  { value: "needs-review", label: "Needs review" },
  { value: "pending", label: "Pending" },
  { value: "suspicious", label: "Suspicious" },
  { value: "malicious", label: "Malicious" },
  { value: "not-run", label: "Not run" },
  { value: "clean", label: "Clean" },
];

export const Route = createFileRoute("/management/plugins")({
  component: PluginManagementRoute,
});

export function PluginManagementRoute() {
  const { me } = useAuthStatus();
  const staff = isModerator(me);
  const [status, setStatus] = useState<QueueStatus>("needs-review");
  const [limit, setLimit] = useState(30);
  const queue = useQuery(
    packageApiRefs.packages.listModerationQueueForStaff as never,
    staff ? ({ status, limit } as never) : "skip",
  ) as PluginQueueResult | undefined;

  if (!staff) {
    return <ManagementAccessNotice me={me} />;
  }

  return (
    <main className="section">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="section-title">Plugin management</h1>
          <p className="section-subtitle">
            Staff package index for moderation queues, StorePack status, release provenance, and
            direct package operations.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/management" search={{ skill: undefined, plugin: undefined }}>
            Back to management
          </Link>
        </Button>
      </div>

      <PluginOperationsNav current="plugins" />

      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="management-tool-grid">
            <label className="management-control management-control-stack">
              <span className="mono">queue</span>
              <select
                className="management-field"
                value={status}
                onChange={(event) => setStatus(event.target.value as QueueStatus)}
              >
                {QUEUE_STATUSES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="management-control management-control-stack">
              <span className="mono">limit</span>
              <input
                className="management-field"
                type="number"
                min={1}
                max={100}
                value={limit}
                onChange={(event) => setLimit(Number.parseInt(event.target.value, 10) || 1)}
              />
            </label>
          </div>
          <div className="management-actions">
            <Badge variant="compact">
              {queue ? `${queue.items.length}${queue.hasMore ? "+" : ""} packages` : "loading"}
            </Badge>
          </div>
        </div>
      </Card>

      <div className="mt-5 grid gap-4">
        {queue === undefined ? (
          <Card>Loading plugin queue...</Card>
        ) : queue.items.length === 0 ? (
          <Card>No plugins found for this queue.</Card>
        ) : (
          queue.items.map((item) => <PluginQueueCard key={item.packageId} item={item} />)
        )}
      </div>
    </main>
  );
}

function PluginQueueCard({ item }: { item: PluginQueueItem }) {
  const release = item.latestRelease;
  return (
    <Card>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="font-display text-lg font-bold text-[color:var(--ink)]"
              to="/management/plugins/$name"
              params={{ name: item.name }}
              search={{ skill: undefined, plugin: undefined }}
            >
              {item.displayName}
            </Link>
            <Badge variant={scanBadgeVariant(item.scanStatus)}>{item.scanStatus}</Badge>
            {item.isOfficial ? <Badge variant="compact">official</Badge> : null}
            {item.executesCode ? <Badge variant="compact">executes code</Badge> : null}
          </div>
          <p className="section-subtitle m-0">{item.summary ?? "No summary provided."}</p>
          <div className="management-sublist">
            <ReportField label="package" value={item.name} mono />
            <ReportField
              label="owner"
              value={item.ownerHandle ? `@${item.ownerHandle}` : "unknown"}
            />
            <ReportField label="family" value={`${familyLabel(item.family)} / ${item.channel}`} />
            <ReportField
              label="latest release"
              value={
                release ? `${release.version} / ${formatTimestamp(release.createdAt)}` : "none"
              }
            />
            <ReportField label="StorePack" value={formatStorePack(release, item)} />
            <ReportField label="source" value={formatSource(release?.source ?? null)} />
            <ReportField
              label="targets"
              value={item.hostTargetKeys.length ? item.hostTargetKeys.join(", ") : "none"}
            />
            <ReportField
              label="environment"
              value={item.environmentFlags.length ? item.environmentFlags.join(", ") : "none"}
            />
          </div>
        </div>
        <div className="management-actions management-action-grid">
          <Button asChild className="management-action-btn" size="sm">
            <Link
              to="/management/plugins/$name"
              params={{ name: item.name }}
              search={{ skill: undefined, plugin: undefined }}
            >
              Manage
            </Link>
          </Button>
          <Button asChild className="management-action-btn" size="sm" variant="outline">
            <Link to="/plugins/$name" params={{ name: item.name }}>
              Public page
            </Link>
          </Button>
          {release?.version ? (
            <Button asChild className="management-action-btn" size="sm" variant="ghost">
              <Link
                to="/plugins/$name/releases/$version"
                params={{ name: item.name, version: release.version }}
              >
                Release
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function ReportField({ label, mono, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="management-report-item">
      <span className="management-report-meta">{label}</span>
      <span className={mono ? "mono" : undefined}>{value}</span>
    </div>
  );
}

function scanBadgeVariant(status: PackageScanStatus) {
  if (status === "clean") return "success";
  if (status === "malicious") return "destructive";
  if (status === "suspicious") return "warning";
  return "pending";
}

function formatStorePack(release: PluginQueueItem["latestRelease"], item: PluginQueueItem) {
  if (release?.storepackRevokedAt) return `revoked ${formatTimestamp(release.storepackRevokedAt)}`;
  if (release?.storepackAvailable || item.storepackAvailable) {
    return [
      release?.storepackFileCount ? `${release.storepackFileCount} files` : "available",
      release?.storepackSha256 ? release.storepackSha256.slice(0, 12) : null,
    ]
      .filter(Boolean)
      .join(" / ");
  }
  return "missing";
}

function formatSource(source: NonNullable<PluginQueueItem["latestRelease"]>["source"]) {
  if (!source) return "missing";
  return [source.repo, source.ref, source.path].filter(Boolean).join(" / ") || "missing";
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
}
