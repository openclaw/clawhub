import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Clock, Info, MoreVertical, Plus, RotateCw, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { DashboardSkeleton } from "../components/skeletons/DashboardSkeleton";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { getUserFacingConvexError } from "../lib/convexError";
import { deriveClawPackLifecycle } from "../lib/packageLifecycle";

type PluginPublishSearch = {
  ownerHandle: string | undefined;
  name: string | undefined;
  displayName: string | undefined;
  family: "code-plugin" | "bundle-plugin" | undefined;
  nextVersion: string | undefined;
  sourceRepo: string | undefined;
};

const emptyPluginPublishSearch = {
  ownerHandle: undefined,
  name: undefined,
  displayName: undefined,
  family: undefined,
  nextVersion: undefined,
  sourceRepo: undefined,
} satisfies PluginPublishSearch;

type DashboardSkill = Pick<
  Doc<"skills">,
  | "_id"
  | "_creationTime"
  | "slug"
  | "displayName"
  | "summary"
  | "ownerUserId"
  | "ownerPublisherId"
  | "canonicalSkillId"
  | "forkOf"
  | "latestVersionId"
  | "tags"
  | "capabilityTags"
  | "badges"
  | "stats"
  | "moderationStatus"
  | "moderationReason"
  | "moderationVerdict"
  | "moderationFlags"
  | "isSuspicious"
  | "createdAt"
  | "updatedAt"
> & {
  pendingReview?: boolean;
  qualityDecision?: "pass" | "quarantine" | "reject";
  latestVersion: {
    version: string;
    createdAt: number;
    vtStatus: string | null;
    llmStatus: string | null;
    staticScanStatus: "clean" | "suspicious" | "malicious" | null;
  } | null;
  rescanState?: DashboardRescanState | null;
};

type DashboardPackage = {
  _id: string;
  name: string;
  displayName: string;
  family: "skill" | "code-plugin" | "bundle-plugin";
  channel: "official" | "community" | "private";
  isOfficial: boolean;
  runtimeId?: string | null;
  sourceRepo?: string | null;
  summary?: string | null;
  latestVersion?: string | null;
  stats: {
    downloads: number;
    installs: number;
    stars: number;
    versions: number;
  };
  verification?: {
    tier?: "structural" | "source-linked" | "provenance-verified" | "rebuild-verified";
  } | null;
  scanStatus?: "clean" | "suspicious" | "malicious" | "pending" | "not-run";
  pendingReview?: boolean;
  latestRelease: {
    version: string;
    createdAt: number;
    vtStatus: string | null;
    llmStatus: string | null;
    staticScanStatus: "clean" | "suspicious" | "malicious" | null;
    clawpackAvailable: boolean;
    clawpackSha256: string | null;
    hostTargets: Array<{
      os: "darwin" | "linux" | "win32";
      arch: "arm64" | "x64";
      libc?: "glibc" | "musl";
    }> | null;
    environment: {
      requiresLocalDesktop?: boolean;
      requiresBrowser?: boolean;
      requiresAudioDevice?: boolean;
      requiresNetwork?: boolean;
    } | null;
  } | null;
  rescanState?: DashboardRescanState | null;
};

type DashboardRescanState = {
  maxRequests: number;
  requestCount: number;
  remainingRequests: number;
  canRequest: boolean;
  inProgressRequest: DashboardRescanRequest | null;
  latestRequest: DashboardRescanRequest | null;
};

type DashboardRescanRequest = {
  _id: string;
  targetKind: "skill" | "plugin";
  targetVersion: string;
  requestedByUserId: string;
  status: "in_progress" | "completed" | "failed";
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

export function Dashboard() {
  const me = useQuery(api.users.me) as Doc<"users"> | null | undefined;
  const publishers = useQuery(api.publishers.listMine) as
    | Array<{
        publisher: {
          _id: string;
          handle: string;
          displayName: string;
          kind: "user" | "org";
        };
        role: "owner" | "admin" | "publisher";
      }>
    | undefined;
  const [selectedPublisherId, setSelectedPublisherId] = useState<string>("");
  const selectedPublisher =
    publishers?.find((entry) => entry.publisher._id === selectedPublisherId) ?? null;

  const mySkills = useQuery(
    api.skills.list,
    selectedPublisher?.publisher.kind === "user" && me?._id
      ? { ownerUserId: me._id, limit: 100 }
      : selectedPublisherId
        ? { ownerPublisherId: selectedPublisherId as Doc<"publishers">["_id"], limit: 100 }
        : me?._id
          ? { ownerUserId: me._id, limit: 100 }
          : "skip",
  ) as DashboardSkill[] | undefined;
  const myPackages = useQuery(
    api.packages.list,
    selectedPublisherId
      ? { ownerPublisherId: selectedPublisherId as Doc<"publishers">["_id"], limit: 100 }
      : me?._id
        ? { ownerUserId: me._id, limit: 100 }
        : "skip",
  ) as DashboardPackage[] | undefined;

  useEffect(() => {
    if (selectedPublisherId) return;
    const personal =
      publishers?.find((entry) => entry.publisher.kind === "user") ?? publishers?.[0];
    if (personal?.publisher._id) {
      setSelectedPublisherId(personal.publisher._id);
    }
  }, [publishers, selectedPublisherId]);

  if (me === undefined) {
    return <DashboardSkeleton />;
  }

  if (me === null) {
    return (
      <main className="section">
        <Card>Sign in to access your dashboard.</Card>
      </main>
    );
  }

  const skills = mySkills ?? [];
  const packages = myPackages ?? [];
  const isLoading = mySkills === undefined;
  const ownerHandle =
    selectedPublisher?.publisher.handle ?? me.handle ?? me.name ?? me.displayName ?? me._id;

  // Welcome state for new users with no content
  if (!isLoading && skills.length === 0 && packages.length === 0) {
    return (
      <main className="section">
        <div className="empty-state">
          <h1 className="empty-state-title text-[1.4rem] font-[family-name:var(--font-display)]">
            Welcome to ClawHub
          </h1>
          <p className="empty-state-body">
            You're signed in as @{ownerHandle}. Get started by publishing your first skill or
            plugin.
          </p>
          <div className="flex gap-3 justify-center">
            <Button asChild variant="primary">
              <Link to="/publish-skill" search={{ updateSlug: undefined }}>
                Publish a Skill
              </Link>
            </Button>
            <Button asChild>
              <Link to="/publish-plugin" search={{ ...emptyPluginPublishSearch, ownerHandle }}>
                Publish a Plugin
              </Link>
            </Button>
            <Button asChild>
              <Link
                to="/skills"
                search={{
                  q: undefined,
                  sort: undefined,
                  dir: undefined,
                  highlighted: undefined,
                  nonSuspicious: true,
                  view: undefined,
                  focus: undefined,
                }}
              >
                Browse Skills
              </Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="section">
      <div className="dashboard-header">
        <div>
          <h1 className="section-title m-0">Dashboard</h1>
          <p className="section-subtitle m-0">View your published skills and plugins.</p>
        </div>
      </div>

      <div className="dashboard-owner-grid">
        <Card className="dashboard-owner-panel">
          <section className="dashboard-collection-block">
            <div className="dashboard-section-header">
              <h2 className="dashboard-collection-title">Skills</h2>
              <Button asChild size="sm" className="dashboard-section-action">
                <Link to="/publish-skill" search={{ updateSlug: undefined }}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New Skill
                </Link>
              </Button>
            </div>
            {skills.length === 0 ? (
              <div className="dashboard-inline-empty">
                <div className="dashboard-inline-empty-copy">
                  <strong>No skills yet.</strong> Publish your first skill to share it with the
                  community.
                </div>
              </div>
            ) : (
              <div className="dashboard-list">
                {skills.map((skill) => (
                  <SkillRow key={skill._id} skill={skill} ownerHandle={ownerHandle} />
                ))}
              </div>
            )}
          </section>
        </Card>

        <Card className="dashboard-owner-panel">
          <section className="dashboard-collection-block">
            <div className="dashboard-section-header">
              <h2 className="dashboard-collection-title">Plugins</h2>
              <Button asChild size="sm" className="dashboard-section-action">
                <Link to="/publish-plugin" search={{ ...emptyPluginPublishSearch, ownerHandle }}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New Plugin
                </Link>
              </Button>
            </div>
            {packages.length === 0 ? (
              <div className="dashboard-inline-empty">
                <div className="dashboard-inline-empty-copy">
                  <strong>No plugins yet.</strong> Publish your first plugin release to validate and
                  distribute it.
                </div>
              </div>
            ) : (
              <div className="dashboard-list">
                {packages.map((pkg) => (
                  <PackageRow key={pkg._id} pkg={pkg} ownerHandle={ownerHandle} />
                ))}
              </div>
            )}
          </section>
        </Card>
      </div>
    </main>
  );
}

function SkillRow({ skill, ownerHandle }: { skill: DashboardSkill; ownerHandle: string | null }) {
  const status = skillDashboardStatus(skill);
  const detailParams = { owner: ownerHandle ?? "unknown", slug: skill.slug };
  const settingsHref = `/${encodeURIComponent(detailParams.owner)}/${encodeURIComponent(
    skill.slug,
  )}/settings`;

  return (
    <div className="dashboard-list-row">
      <div className="dashboard-list-primary">
        <div className="dashboard-list-title">
          <Link to="/$owner/$slug" params={detailParams} className="dashboard-skill-name">
            {skill.displayName}
          </Link>
        </div>
      </div>
      <div className="dashboard-list-summary">{skill.summary ?? "No summary provided."}</div>
      <div className="dashboard-list-status">
        <StatusChipWithTooltip status={status} />
      </div>
      <RowMenu
        kind="skill"
        targetId={skill._id}
        targetLabel={skill.displayName}
        settingsHref={settingsHref}
        statusLabel={status.label}
        rescanState={skill.rescanState ?? null}
        releaseLink={null}
      />
    </div>
  );
}

function StatusChipWithTooltip({
  status,
}: {
  status: {
    key?: string;
    label: string;
    description: string;
    variant: "default" | "pending" | "warning" | "destructive" | "success";
  };
}) {
  const showInfo = status.label !== "Visible";

  return (
    <Badge variant={status.variant} className="dashboard-status-chip">
      {status.key === "pending" ? <Clock className="h-3 w-3" aria-hidden="true" /> : null}
      {status.label}
      {showInfo ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="dashboard-status-info"
              aria-label={`${status.label} status reason`}
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="end">
            {status.description}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </Badge>
  );
}

function packageDashboardStatus(pkg: DashboardPackage): {
  label: string;
  description: string;
  variant: "default" | "pending" | "warning" | "destructive" | "success";
} {
  const lifecycle = deriveClawPackLifecycle({
    available: pkg.latestRelease?.clawpackAvailable ?? false,
    verificationScanStatus: pkg.scanStatus,
    vtStatus: pkg.latestRelease?.vtStatus,
    llmStatus: pkg.latestRelease?.llmStatus,
    staticScanStatus: pkg.latestRelease?.staticScanStatus,
  });
  if (lifecycle.state === "clawpack-missing") {
    return {
      label: lifecycle.label,
      description: lifecycle.description,
      variant: "warning",
    };
  }
  if (lifecycle.state === "scan-pending") {
    return {
      label: lifecycle.label,
      description: lifecycle.description,
      variant: "pending",
    };
  }
  if (lifecycle.state === "ready") {
    return {
      label: lifecycle.label,
      description: lifecycle.description,
      variant: "success",
    };
  }
  const releaseStatuses = new Set([
    pkg.latestRelease?.vtStatus,
    pkg.latestRelease?.llmStatus,
    pkg.latestRelease?.staticScanStatus,
  ]);
  if (pkg.scanStatus === "malicious" || releaseStatuses.has("malicious")) {
    return {
      label: "Blocked",
      description: "Security checks found malicious content.",
      variant: "destructive",
    };
  }
  if (pkg.scanStatus === "suspicious" || releaseStatuses.has("suspicious")) {
    return {
      label: "Suspicious",
      description: "Security checks flagged this plugin for review.",
      variant: "warning",
    };
  }
  if (pkg.scanStatus === "pending" || pkg.pendingReview) {
    return {
      label: "Pending checks",
      description: "Security verification is still running.",
      variant: "pending",
    };
  }
  if (pkg.scanStatus === "clean") {
    return {
      label: "Visible",
      description: "Available on public catalog surfaces.",
      variant: "success",
    };
  }
  return {
    label: "Unknown",
    description: "Open the plugin for the latest release and security details.",
    variant: "default",
  };
}

function PackageRow({ pkg, ownerHandle }: { pkg: DashboardPackage; ownerHandle: string }) {
  const status = packageDashboardStatus(pkg);

  return (
    <div className="dashboard-list-row">
      <div className="dashboard-list-primary">
        <div className="dashboard-list-title">
          <Link to="/plugins/$name" params={{ name: pkg.name }} className="dashboard-skill-name">
            {pkg.displayName}
          </Link>
        </div>
      </div>
      <div className="dashboard-list-summary">{pkg.summary ?? "No summary provided."}</div>
      <div className="dashboard-list-status">
        <StatusChipWithTooltip status={status} />
      </div>
      <RowMenu
        kind="plugin"
        targetId={pkg._id}
        targetLabel={pkg.displayName}
        settingsHref={`/plugins/${encodeURIComponent(pkg.name)}`}
        statusLabel={status.label}
        rescanState={pkg.rescanState ?? null}
        releaseLink={{
          to: "/publish-plugin",
          search: {
            ...emptyPluginPublishSearch,
            ownerHandle,
            name: pkg.name,
            displayName: pkg.displayName,
            family: pkg.family === "bundle-plugin" ? "bundle-plugin" : "code-plugin",
            nextVersion: undefined,
            sourceRepo: pkg.sourceRepo ?? undefined,
          },
        }}
      />
    </div>
  );
}

function canShowDashboardRescan(statusLabel: string, state: DashboardRescanState | null) {
  if (statusLabel === "Visible" || statusLabel === "Ready") return false;
  if (!state) return true;
  return state.canRequest && !state.inProgressRequest && state.remainingRequests > 0;
}

function RowMenu({
  kind,
  targetId,
  targetLabel,
  settingsHref,
  statusLabel,
  rescanState,
  releaseLink,
}: {
  kind: "skill" | "plugin";
  targetId: string;
  targetLabel: string;
  settingsHref: string;
  statusLabel: string;
  rescanState: DashboardRescanState | null;
  releaseLink: {
    to: "/publish-plugin";
    search: PluginPublishSearch & {
      ownerHandle: string;
      name: string;
      displayName: string;
      family: "code-plugin" | "bundle-plugin";
      sourceRepo?: string;
    };
  } | null;
}) {
  const requestSkillRescan = useMutation(api.skills.requestRescan);
  const requestPluginRescan = useMutation(api.packages.requestRescan);
  const [isRequesting, setIsRequesting] = useState(false);
  const isScanInProgress = Boolean(rescanState?.inProgressRequest);
  const showRescan = canShowDashboardRescan(statusLabel, rescanState);
  const showRescanItem = showRescan || isScanInProgress;
  const rescanLabel = isScanInProgress
    ? "Scan in progress"
    : isRequesting
      ? "Requesting..."
      : "Request rescan";

  async function requestRescan() {
    if (!showRescan || isRequesting) return;
    setIsRequesting(true);
    try {
      if (kind === "skill") {
        await requestSkillRescan({ skillId: targetId as Doc<"skills">["_id"] });
      } else {
        await requestPluginRescan({ packageId: targetId as Doc<"packages">["_id"] });
      }
      toast.success(`Rescan requested for ${targetLabel}.`);
    } catch (error) {
      toast.error(getUserFacingConvexError(error, "Could not request a rescan."));
    } finally {
      setIsRequesting(false);
    }
  }

  return (
    <div className="dashboard-row-menu">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Open actions for ${targetLabel}`}
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="dashboard-row-menu-content">
          <DropdownMenuItem asChild>
            <a href={settingsHref}>
              <Settings className="h-4 w-4" aria-hidden="true" />
              Settings
            </a>
          </DropdownMenuItem>
          {releaseLink ? (
            <DropdownMenuItem asChild>
              <Link to={releaseLink.to} search={releaseLink.search}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New release
              </Link>
            </DropdownMenuItem>
          ) : null}
          {showRescanItem ? (
            <DropdownMenuItem
              disabled={isRequesting || isScanInProgress}
              onSelect={() => void requestRescan()}
            >
              <RotateCw
                className={
                  isRequesting || isScanInProgress
                    ? "h-4 w-4 animate-spin [animation-duration:2.4s]"
                    : "h-4 w-4"
                }
                aria-hidden="true"
              />
              {rescanLabel}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function skillDashboardStatus(skill: DashboardSkill): {
  key: "visible" | "pending" | "suspicious" | "blocked" | "hidden" | "removed" | "quality";
  label: string;
  description: string;
  variant: "default" | "pending" | "warning" | "destructive" | "success";
} {
  const flags = skill.moderationFlags ?? [];
  const reason = skill.moderationReason ?? "";
  const versionStatuses = new Set([
    skill.latestVersion?.vtStatus,
    skill.latestVersion?.llmStatus,
    skill.latestVersion?.staticScanStatus,
  ]);
  if (skill.moderationStatus === "removed") {
    return {
      key: "removed",
      label: "Removed",
      description: "Removed from public inventory by moderation.",
      variant: "destructive",
    };
  }
  if (
    flags.includes("blocked.malware") ||
    skill.moderationVerdict === "malicious" ||
    versionStatuses.has("malicious")
  ) {
    return {
      key: "blocked",
      label: "Blocked",
      description:
        "Unavailable publicly because automated security checks found malicious content.",
      variant: "destructive",
    };
  }
  if (skill.pendingReview || reason === "pending.scan" || reason === "pending.scan.stale") {
    return {
      key: "pending",
      label: "Pending checks",
      description: "Hidden until security verification checks finish.",
      variant: "pending",
    };
  }
  if (
    skill.qualityDecision === "quarantine" ||
    skill.qualityDecision === "reject" ||
    reason === "quality.low"
  ) {
    return {
      key: "quality",
      label: "Quality held",
      description: "Unavailable while quality review is holding this release.",
      variant: "warning",
    };
  }
  if (
    skill.isSuspicious ||
    flags.includes("flagged.suspicious") ||
    skill.moderationVerdict === "suspicious" ||
    versionStatuses.has("suspicious")
  ) {
    return {
      key: "suspicious",
      label: "Suspicious",
      description:
        "Visible to you, but public surfaces warn or suppress it because it was flagged.",
      variant: "warning",
    };
  }
  if (skill.moderationStatus === "hidden") {
    return {
      key: "hidden",
      label: "Hidden",
      description: "Hidden from public catalog surfaces.",
      variant: "warning",
    };
  }
  return {
    key: "visible",
    label: "Visible",
    description: "Available on public catalog surfaces.",
    variant: "success",
  };
}
