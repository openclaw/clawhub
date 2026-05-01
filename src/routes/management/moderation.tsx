import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { familyLabel } from "../../lib/packageLabels";
import { isModerator } from "../../lib/roles";
import { useAuthStatus } from "../../lib/useAuthStatus";

const packageApiRefs = api as unknown as {
  packages: {
    listModerationQueueForStaff: unknown;
    setModerationVerdict: unknown;
  };
};

type PackageScanStatus = "clean" | "suspicious" | "malicious" | "pending" | "not-run";
type QueueStatus = PackageScanStatus | "needs-review";

type ModerationQueueItem = {
  packageId: Id<"packages">;
  name: string;
  displayName: string;
  family: "skill" | "code-plugin" | "bundle-plugin";
  channel: "official" | "community" | "private";
  isOfficial: boolean;
  ownerHandle?: string;
  ownerKind?: "user" | "org";
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
  } | null;
};

type ModerationQueueResult = {
  items: ModerationQueueItem[];
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

const VERDICTS: Array<{ value: PackageScanStatus; label: string }> = [
  { value: "clean", label: "Approve clean" },
  { value: "suspicious", label: "Mark suspicious" },
  { value: "malicious", label: "Mark malicious" },
  { value: "pending", label: "Hold pending" },
];

export const Route = createFileRoute("/management/moderation")({
  component: PluginModerationRoute,
});

export function PluginModerationRoute() {
  const { me } = useAuthStatus();
  const staff = isModerator(me);
  const [status, setStatus] = useState<QueueStatus>("needs-review");
  const [limit, setLimit] = useState(30);
  const [activeWrite, setActiveWrite] = useState<string | null>(null);
  const queue = useQuery(
    packageApiRefs.packages.listModerationQueueForStaff as never,
    staff ? { status, limit } : "skip",
  ) as ModerationQueueResult | undefined;
  const setModerationVerdict = useMutation(
    packageApiRefs.packages.setModerationVerdict as never,
  ) as unknown as (args: {
    packageId: Id<"packages">;
    verdict: PackageScanStatus;
    note?: string;
  }) => Promise<unknown>;

  if (!staff) {
    return (
      <main className="section">
        <Card>Management only.</Card>
      </main>
    );
  }

  const normalizedLimit = Math.max(1, Math.min(limit, 100));

  const runVerdict = async (item: ModerationQueueItem, verdict: PackageScanStatus) => {
    const note = window.prompt(`Audit note for ${item.name} -> ${verdict}`);
    if (note === null) return;
    const trimmed = note.trim();
    if (!trimmed) {
      window.alert("Audit note is required.");
      return;
    }
    if (
      !window.confirm(
        `Set ${item.name} moderation verdict to ${verdict}?\n\nThis writes a package moderation verdict and audit log in Convex.`,
      )
    ) {
      return;
    }
    setActiveWrite(`${item.packageId}:${verdict}`);
    try {
      await setModerationVerdict({ packageId: item.packageId, verdict, note: trimmed });
    } catch (error) {
      window.alert(formatMutationError(error));
    } finally {
      setActiveWrite(null);
    }
  };

  return (
    <main className="section">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="section-title">Plugin moderation</h1>
          <p className="section-subtitle">
            Review code and bundle plugins by scan state, StorePack status, channel, and release
            risk.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/management">Back to management</Link>
        </Button>
      </div>

      <Card className="mb-5">
        <div className="management-tool-grid">
          <label className="management-control management-control-stack">
            <span className="mono">queue</span>
            <select
              className="management-field"
              value={status}
              onChange={(event) => setStatus(event.target.value as QueueStatus)}
            >
              {QUEUE_STATUSES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
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
      </Card>

      <div className="grid gap-4">
        {(queue?.items ?? []).map((item) => (
          <Card key={item.packageId}>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
                      {item.displayName}
                    </h2>
                    <Badge variant={item.scanStatus === "malicious" ? "accent" : "compact"}>
                      {item.scanStatus}
                    </Badge>
                    <Badge variant="compact">{familyLabel(item.family)}</Badge>
                    <Badge variant="compact">{item.channel}</Badge>
                  </div>
                  <p className="section-subtitle m-0">
                    <span className="mono">{item.name}</span>
                    {item.runtimeId ? ` · runtime ${item.runtimeId}` : ""}
                    {item.latestVersion ? ` · latest ${item.latestVersion}` : ""}
                  </p>
                </div>
                <div className="management-actions management-actions-start">
                  <Button asChild variant="outline" size="sm">
                    <Link to="/management" search={{ skill: undefined, plugin: item.name }}>
                      Manage
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link to="/plugins/$name" params={{ name: item.name }}>
                      Public page
                    </Link>
                  </Button>
                </div>
              </div>

              <div className="management-tool-grid">
                <ReportField label="owner" value={formatOwner(item)} />
                <ReportField
                  label="StorePack"
                  value={formatStorePackState(item)}
                  tone={item.storepackAvailable ? undefined : "warn"}
                />
                <ReportField label="verification" value={item.verificationTier ?? "unverified"} />
                <ReportField
                  label="updated"
                  value={new Date(item.updatedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                />
              </div>

              {item.summary ? (
                <p className="m-0 text-sm text-[color:var(--ink-soft)]">{item.summary}</p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {item.hostTargetKeys.length > 0 ? (
                  item.hostTargetKeys.map((target) => (
                    <Badge key={target} variant="compact">
                      {target}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="compact">no host targets</Badge>
                )}
                {item.environmentFlags.map((flag) => (
                  <Badge key={flag} variant="compact">
                    {flag}
                  </Badge>
                ))}
              </div>

              <div className="management-actions management-actions-start">
                {VERDICTS.map((verdict) => (
                  <Button
                    key={verdict.value}
                    type="button"
                    variant={verdict.value === "clean" ? "default" : "outline"}
                    size="sm"
                    disabled={activeWrite !== null}
                    onClick={() => void runVerdict(item, verdict.value)}
                  >
                    {activeWrite === `${item.packageId}:${verdict.value}`
                      ? "Saving..."
                      : verdict.label}
                  </Button>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {queue && queue.items.length === 0 ? <Card>No plugins in the selected queue.</Card> : null}
      {queue?.hasMore ? (
        <Card className="mt-4">
          Showing the newest {normalizedLimit} rows. Narrow the queue or raise the limit for the
          next review batch.
        </Card>
      ) : null}
    </main>
  );
}

function ReportField(props: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="management-report-item">
      <span className="management-report-meta">{props.label}</span>
      <span className={props.tone === "warn" ? "text-[color:var(--danger)]" : undefined}>
        {props.value}
      </span>
    </div>
  );
}

function formatOwner(item: ModerationQueueItem) {
  const handle = item.ownerHandle?.trim();
  if (!handle) return "unknown owner";
  return `${handle}${item.ownerKind ? ` (${item.ownerKind})` : ""}`;
}

function formatStorePackState(item: ModerationQueueItem) {
  if (item.latestRelease?.storepackRevokedAt) {
    return `revoked ${new Date(item.latestRelease.storepackRevokedAt).toLocaleDateString()}`;
  }
  if (item.latestRelease?.storepackAvailable || item.storepackAvailable) {
    const digest = item.latestRelease?.storepackSha256?.slice(0, 12);
    const count = item.latestRelease?.storepackFileCount;
    return (
      [count ? `${count} files` : null, digest ?? null].filter(Boolean).join(" / ") || "stored"
    );
  }
  return "missing artifact";
}

function formatMutationError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
