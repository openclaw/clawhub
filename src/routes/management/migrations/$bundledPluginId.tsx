import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { ManagementAccessNotice } from "../../../components/ManagementAccessNotice";
import { PluginOperationsNav } from "../../../components/PluginOperationsNav";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import {
  formatReadinessSource,
  formatReadinessStorePack,
  type MigrationReadinessItem,
  type MigrationReadinessResult,
  readinessStateLabel,
} from "../../../lib/officialMigrationReadiness";
import { isModerator } from "../../../lib/roles";
import { useAuthStatus } from "../../../lib/useAuthStatus";

const packageApiRefs = api as unknown as {
  packages: {
    listOfficialMigrationReadinessForStaff: unknown;
  };
};

export const Route = createFileRoute("/management/migrations/$bundledPluginId")({
  component: OfficialMigrationDetailRoute,
});

export function OfficialMigrationDetailRoute() {
  const params = Route.useParams();
  return <OfficialMigrationDetailPage bundledPluginId={params.bundledPluginId} />;
}

export function OfficialMigrationDetailPage(props: { bundledPluginId: string }) {
  const { me } = useAuthStatus();
  const staff = isModerator(me);
  const readiness = useQuery(
    packageApiRefs.packages.listOfficialMigrationReadinessForStaff as never,
    staff ? {} : "skip",
  ) as MigrationReadinessResult | undefined;

  if (!staff) {
    return <ManagementAccessNotice me={me} />;
  }

  const item = readiness?.items.find(
    (candidate) => candidate.bundledPluginId === props.bundledPluginId,
  );

  return (
    <main className="section">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="section-title">Migration candidate</h1>
          <p className="section-subtitle">
            ClawHub readiness gates for one future OpenClaw bundled-plugin externalization target.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/management/migrations" search={{ skill: undefined, plugin: undefined }}>
              Back to readiness
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/management/storepacks" search={{ skill: undefined, plugin: undefined }}>
              StorePack ops
            </Link>
          </Button>
        </div>
      </div>

      <PluginOperationsNav current="migrations" />

      {readiness === undefined ? (
        <Card>Loading migration candidate…</Card>
      ) : item ? (
        <MigrationCandidateDetail item={item} />
      ) : (
        <Card>
          <div className="management-report-item">
            <span className="management-report-meta">not found</span>
            <span className="mono">{props.bundledPluginId}</span>
          </div>
          <p className="section-subtitle m-0 mt-2">
            No official migration candidate is configured for this bundled plugin id.
          </p>
        </Card>
      )}
    </main>
  );
}

function MigrationCandidateDetail(props: { item: MigrationReadinessItem }) {
  const { item } = props;
  const ready = item.readinessState === "ready-for-openclaw";
  return (
    <div className="grid gap-5">
      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="m-0 font-display text-2xl font-bold text-[color:var(--ink)]">
                  {item.displayName}
                </h2>
                <Badge variant={ready ? "compact" : "accent"}>
                  {readinessStateLabel(item.readinessState)}
                </Badge>
                {item.package?.isOfficial ? <Badge variant="compact">official</Badge> : null}
              </div>
              <p className="section-subtitle m-0">
                <span className="mono">{item.bundledPluginId}</span> to{" "}
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
                    Manage package
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>

          <div className="management-tool-grid">
            <ReportField label="publisher" value={`@${item.publisherHandle}`} />
            <ReportField label="source" value={formatReadinessSource(item)} />
            <ReportField label="source path" value={item.sourcePath || "."} />
            <ReportField label="StorePack" value={formatReadinessStorePack(item)} />
            <ReportField
              label="latest release"
              value={item.latestRelease ? `v${item.latestRelease.version}` : "missing"}
            />
            <ReportField
              label="scan"
              value={item.latestRelease?.scanStatus ?? item.package?.scanStatus ?? "missing"}
            />
            <ReportField
              label="runtime bundle"
              value={item.gates.runtimeBundleStatus.replaceAll("-", " ")}
            />
            <ReportField
              label="generated package"
              value={item.package ? item.package.displayName : "missing"}
            />
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="m-0 font-display text-lg font-bold text-[color:var(--ink)]">
          Readiness gates
        </h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          <Gate label="Package exists" ok={item.gates.packageExists} />
          <Gate label="Release exists" ok={item.gates.releaseExists} />
          <Gate label="StorePack active" ok={item.gates.storepackAvailable} />
          <Gate label="Host matrix complete" ok={item.gates.hostMatrixComplete} />
          <Gate label="Environment complete" ok={item.gates.environmentComplete} />
          <Gate label="Source linked" ok={item.gates.sourceLinked} />
          <Gate label="Scan clear" ok={item.gates.scanClear} />
          <Gate
            label="Runtime bundle decided"
            ok={item.gates.runtimeBundleStatus === "not-required"}
          />
        </div>
      </Card>

      <Card>
        <h3 className="m-0 font-display text-lg font-bold text-[color:var(--ink)]">Evidence</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <EvidenceList
            title="Required hosts"
            values={item.requiredHostTargets}
            empty="no required hosts configured"
          />
          <EvidenceList
            title="Release hosts"
            values={item.latestRelease?.hostTargetKeys ?? []}
            empty="no release host targets"
          />
          <EvidenceList
            title="Environment flags"
            values={item.latestRelease?.environmentFlags ?? []}
            empty="no environment flags"
          />
          <EvidenceList
            title="Blockers"
            values={item.blockers.map((blocker) => blocker.replaceAll("-", " "))}
            empty="no blockers"
          />
        </div>
      </Card>
    </div>
  );
}

function ReportField(props: { label: string; value: string }) {
  return (
    <div className="management-report-item">
      <span className="management-report-meta">{props.label}</span>
      <span>{props.value}</span>
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

function EvidenceList(props: { title: string; values: string[]; empty: string }) {
  return (
    <div className="management-report-item">
      <span className="management-report-meta">{props.title}</span>
      <span>{props.values.length ? props.values.join(", ") : props.empty}</span>
    </div>
  );
}
