import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Box, Loader2, MoreVertical, Package, Plus, Settings, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { ArtifactCard } from "../components/artifacts/ArtifactCard";
import { packageArtifactStatus, skillArtifactStatus } from "../components/artifacts/artifactStatus";
import { DashboardSkeleton } from "../components/skeletons/DashboardSkeleton";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { getUserFacingConvexError } from "../lib/convexError";

const emptyPluginPublishSearch = {
  ownerHandle: undefined,
  name: undefined,
  displayName: undefined,
  family: undefined,
  nextVersion: undefined,
  sourceRepo: undefined,
} as const;

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
  ownerPath: string;
  detailHref: string;
  settingsHref: string;
  pendingReview?: boolean;
  qualityDecision?: "pass" | "quarantine" | "reject";
  latestVersion: {
    version: string;
    createdAt: number;
    vtStatus: string | null;
    llmStatus: string | null;
    staticScanStatus: "clean" | "suspicious" | "malicious" | null;
  } | null;
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
  updatedAt: number;
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
  } | null;
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

  const skillsQueryArgs =
    selectedPublisher?.publisher.kind === "user" && me?._id
      ? { ownerUserId: me._id }
      : selectedPublisherId
        ? { ownerPublisherId: selectedPublisherId as Doc<"publishers">["_id"] }
        : me?._id
          ? { ownerUserId: me._id }
          : "skip";
  const {
    results: paginatedSkills,
    status: skillsStatus,
    loadMore,
  } = usePaginatedQuery(api.skills.listDashboardPaginated, skillsQueryArgs, {
    initialNumItems: 50,
  });
  const mySkills = paginatedSkills as DashboardSkill[] | undefined;
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
  const isLoading = skillsStatus === "LoadingFirstPage";
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
              <Link to="/skills/publish" search={{ updateSlug: undefined }}>
                Publish a Skill
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
        <section className="dashboard-collection-block">
          <div className="dashboard-section-header">
            <h2 className="dashboard-collection-title">Skills</h2>
            <Button asChild size="sm" className="dashboard-section-action">
              <Link to="/skills/publish" search={{ updateSlug: undefined }}>
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
                <SkillRow key={skill._id} skill={skill} />
              ))}
            </div>
          )}
          {skills.length > 0 && skillsStatus === "CanLoadMore" && (
            <div className="mt-4 flex justify-center">
              <Button onClick={() => loadMore(50)}>Load More</Button>
            </div>
          )}
          {skillsStatus === "LoadingMore" && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Loading more skills...</span>
            </div>
          )}
        </section>

        <section className="dashboard-collection-block">
          <div className="dashboard-section-header">
            <h2 className="dashboard-collection-title">Plugins</h2>
            <Button asChild size="sm" className="dashboard-section-action">
              <Link to="/plugins/publish" search={{ ...emptyPluginPublishSearch, ownerHandle }}>
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
                <PackageRow key={pkg._id} pkg={pkg} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function SkillRow({ skill }: { skill: DashboardSkill }) {
  const status = skillArtifactStatus(skill);
  const titleId = `dashboard-skill-title-${skill._id}`;
  const stats = [
    { label: "Downloads", value: formatCompactNumber(skill.stats?.downloads ?? 0) },
    { label: "Stars", value: formatCompactNumber(skill.stats?.stars ?? 0) },
    { label: "Versions", value: formatCompactNumber(skill.stats?.versions ?? 0) },
    { label: "Updated", value: formatShortDate(skill.updatedAt) },
  ];

  return (
    <ArtifactCard
      href={skill.detailHref}
      title={skill.displayName}
      titleId={titleId}
      icon={<Box className="h-5 w-5" />}
      meta={
        <>
          <span>Skill</span>
          <span>
            /{skill.ownerPath}/{skill.slug}
          </span>
          {skill.latestVersion?.version ? <span>v{skill.latestVersion.version}</span> : null}
        </>
      }
      summary={skill.summary}
      status={status}
      scanSignals={{
        vtStatus: skill.latestVersion?.vtStatus ?? null,
        llmStatus: skill.latestVersion?.llmStatus ?? null,
        staticScanStatus: skill.latestVersion?.staticScanStatus ?? null,
      }}
      stats={stats}
      actions={
        <RowMenu
          kind="skill"
          targetId={skill._id}
          targetLabel={skill.displayName}
          settingsHref={skill.settingsHref}
        />
      }
    />
  );
}

function PackageRow({ pkg }: { pkg: DashboardPackage }) {
  const status = packageArtifactStatus(pkg);
  const detailHref = `/plugins/${encodeURIComponent(pkg.name)}`;
  const titleId = `dashboard-package-title-${pkg._id}`;
  const familyLabel =
    pkg.family === "bundle-plugin"
      ? "Bundle Plugin"
      : pkg.family === "code-plugin"
        ? "Code Plugin"
        : "Skill Package";
  const stats = [
    { label: "Downloads", value: formatCompactNumber(pkg.stats.downloads ?? 0) },
    { label: "Stars", value: formatCompactNumber(pkg.stats.stars ?? 0) },
    { label: "Updated", value: formatShortDate(pkg.updatedAt) },
  ];

  return (
    <ArtifactCard
      href={detailHref}
      title={pkg.displayName}
      titleId={titleId}
      icon={<Package className="h-5 w-5" />}
      meta={
        <>
          <span>{familyLabel}</span>
          <span>{pkg.name}</span>
          {pkg.latestVersion ? <span>v{pkg.latestVersion}</span> : null}
          <span>{pkg.channel}</span>
        </>
      }
      summary={pkg.summary}
      status={status}
      scanSignals={{
        vtStatus: pkg.latestRelease?.vtStatus ?? null,
        llmStatus: pkg.latestRelease?.llmStatus ?? null,
        staticScanStatus: pkg.latestRelease?.staticScanStatus ?? null,
      }}
      stats={stats}
      actions={
        <RowMenu
          kind="plugin"
          targetId={pkg._id}
          targetLabel={pkg.displayName}
          settingsHref={detailHref}
        />
      }
    />
  );
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatShortDate(timestamp: number | undefined) {
  if (!timestamp) return "Unknown";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(timestamp),
  );
}

function RowMenu({
  kind,
  targetId,
  targetLabel,
  settingsHref,
}: {
  kind: "skill" | "plugin";
  targetId: string;
  targetLabel: string;
  settingsHref: string;
}) {
  const deletePackage = useMutation(api.packages.softDeletePackage);
  const [isDeleting, setIsDeleting] = useState(false);

  async function deletePlugin() {
    if (kind !== "plugin" || isDeleting) return;
    const confirmed = window.confirm(
      `Delete ${targetLabel}? This removes the plugin package and all releases from ClawHub.`,
    );
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await deletePackage({ packageId: targetId as Doc<"packages">["_id"] });
      toast.success(`Deleted ${targetLabel}.`);
    } catch (error) {
      toast.error(getUserFacingConvexError(error, "Could not delete this plugin."));
    } finally {
      setIsDeleting(false);
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
          {kind === "plugin" ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isDeleting}
                variant="destructive"
                onSelect={() => void deletePlugin()}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {isDeleting ? "Deleting..." : "Delete plugin"}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
