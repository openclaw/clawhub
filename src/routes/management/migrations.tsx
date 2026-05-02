import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { ManagementAccessNotice } from "../../components/ManagementAccessNotice";
import { PluginOperationsNav } from "../../components/PluginOperationsNav";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import {
  formatReadinessSource,
  formatReadinessStorePack,
  readinessBlockerLabel,
  type MigrationReadinessItem,
  type MigrationReadinessResult,
  readinessStateLabel,
} from "../../lib/officialMigrationReadiness";
import { isModerator } from "../../lib/roles";
import { useAuthStatus } from "../../lib/useAuthStatus";

const packageApiRefs = api as unknown as {
  packages: {
    listOfficialMigrationReadinessForStaff: unknown;
  };
};

export const Route = createFileRoute("/management/migrations")({
  component: OfficialMigrationRoute,
});

export function OfficialMigrationRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname !== "/management/migrations") return <Outlet />;
  return <OfficialMigrationConsole />;
}

function OfficialMigrationConsole() {
  const { me } = useAuthStatus();
  const staff = isModerator(me);
  const readiness = useQuery(
    packageApiRefs.packages.listOfficialMigrationReadinessForStaff as never,
    staff ? {} : "skip",
  ) as MigrationReadinessResult | undefined;

  if (!staff) {
    return <ManagementAccessNotice me={me} />;
  }

  const items = readiness?.items ?? [];

  return (
    <main className="section">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="section-title">OpenClaw migration readiness</h1>
          <p className="section-subtitle">
            ClawHub-side package, artifact, metadata, scan, and source gates for future bundled
            plugin externalization.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/management" search={{ skill: undefined, plugin: undefined }}>
              Back to management
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/management/clawpacks" search={{ skill: undefined, plugin: undefined }}>
              Claw Pack ops
            </Link>
          </Button>
        </div>
      </div>

      <PluginOperationsNav current="migrations" />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Ready"
          value={readiness ? String(readiness.readyCount) : "..."}
          detail="all ClawHub gates green"
        />
        <MetricCard
          label="Blocked"
          value={readiness ? String(readiness.blockedCount) : "..."}
          detail="missing package, artifact, metadata, source, or scan"
        />
        <MetricCard
          label="Tracked"
          value={readiness ? String(readiness.items.length) : "..."}
          detail={readiness ? `generated ${formatTimestamp(readiness.generatedAt)}` : "loading"}
        />
      </div>

      <div className="mt-5 grid gap-4">
        {readiness === undefined ? (
          <Card>Loading migration readiness…</Card>
        ) : items.length === 0 ? (
          <Card>No migration candidates are configured.</Card>
        ) : (
          items.map((item) => <MigrationCard key={item.bundledPluginId} item={item} />)
        )}
      </div>
    </main>
  );
}

function MigrationCard(props: { item: MigrationReadinessItem }) {
  const { item } = props;
  const ready = item.readinessState === "ready-for-openclaw";
  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 font-display text-xl font-bold text-[color:var(--ink)]">
                {item.displayName}
              </h2>
              <Badge variant={ready ? "compact" : "accent"}>
                {readinessStateLabel(item.readinessState)}
              </Badge>
              {item.package?.isOfficial ? <Badge variant="compact">official</Badge> : null}
            </div>
            <p className="section-subtitle m-0">
              <span className="mono">{item.bundledPluginId}</span> →{" "}
              <span className="mono">{item.desiredPackageName}</span>
            </p>
          </div>
          <div className="management-actions management-actions-start">
            {item.package ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/plugins/$name" params={{ name: item.package.name }}>
                  Plugin page
                </Link>
              </Button>
            ) : null}
            {item.package ? (
              <Button asChild variant="ghost" size="sm">
                <Link to="/management" search={{ skill: undefined, plugin: item.package.name }}>
                  Manage
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/management/migrations/$bundledPluginId"
                params={{ bundledPluginId: item.bundledPluginId }}
                search={{ skill: undefined, plugin: undefined }}
              >
                Details
              </Link>
            </Button>
          </div>
        </div>

        <div className="management-tool-grid">
          <ReportField label="publisher" value={`@${item.publisherHandle}`} />
          <ReportField
            label="source"
            value={formatReadinessSource(item)}
            tone={item.gates.sourceLinked ? undefined : "warn"}
          />
          <ReportField
            label="release"
            value={item.latestRelease ? `v${item.latestRelease.version}` : "missing"}
            tone={item.latestRelease ? undefined : "warn"}
          />
          <ReportField
            label="Claw Pack"
            value={formatReadinessStorePack(item)}
            tone={item.gates.storepackAvailable ? undefined : "warn"}
          />
        </div>

        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
          <Gate label="Package" ok={item.gates.packageExists} />
          <Gate label="Release" ok={item.gates.releaseExists} />
          <Gate label="Claw Pack" ok={item.gates.storepackAvailable} />
          <Gate label="Host matrix" ok={item.gates.hostMatrixComplete} />
          <Gate label="Environment" ok={item.gates.environmentComplete} />
          <Gate label="Source" ok={item.gates.sourceLinked} />
          <Gate label="Scan" ok={item.gates.scanClear} />
          <Gate label="Runtime bundle" ok={item.gates.runtimeBundleStatus === "not-required"} />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {item.latestRelease?.hostTargetKeys.length ? (
            item.latestRelease.hostTargetKeys.map((target) => (
              <Badge key={target} variant="compact">
                {target}
              </Badge>
            ))
          ) : (
            <Badge variant="compact">no host targets</Badge>
          )}
          {item.latestRelease?.environmentFlags.map((flag) => (
            <Badge key={flag} variant="compact">
              {flag}
            </Badge>
          ))}
        </div>

        {item.blockers.length > 0 ? (
          <div className="management-report-item">
            <span className="management-report-meta">blockers</span>
            <span>{item.blockers.map(readinessBlockerLabel).join(", ")}</span>
          </div>
        ) : null}
      </div>
    </Card>
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

function Gate(props: { label: string; ok: boolean }) {
  return (
    <div className="management-report-item">
      <span className="management-report-meta">{props.label}</span>
      <span
        className={
          props.ok ? "text-emerald-700 dark:text-emerald-300" : "text-[color:var(--danger)]"
        }
      >
        {props.ok ? "ready" : "blocked"}
      </span>
    </div>
  );
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
}
