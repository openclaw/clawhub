import { createFileRoute, Link } from "@tanstack/react-router";
import { usePaginatedQuery, useQuery } from "convex/react";
import { AlertTriangle, Box, Download, Loader2, Package, Plus, Settings } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { ArtifactCard } from "../components/artifacts/ArtifactCard";
import { packageArtifactStatus, skillArtifactStatus } from "../components/artifacts/artifactStatus";
import { SignInPrompt } from "../components/SignInPrompt";
import { DashboardSkeleton } from "../components/skeletons/DashboardSkeleton";
import { buildSkillHref } from "../components/skillDetailUtils";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { buildPluginDetailHref, buildPluginValidationHref } from "../lib/pluginRoutes";
import { useAuthStatus } from "../lib/useAuthStatus";

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
  detailHref?: string;
  settingsHref?: string;
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
  inspectorWarningCount?: number;
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
  const { isAuthenticated, isLoading: isAuthLoading, me } = useAuthStatus();
  const publishers = useQuery(api.publishers.listMine, me ? {} : "skip") as
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
  const defaultPublisher =
    publishers?.find((entry) => entry.publisher.kind === "user") ?? publishers?.[0] ?? null;
  const selectedPublisherFromState = selectedPublisherId
    ? (publishers?.find((entry) => entry.publisher._id === selectedPublisherId) ?? null)
    : null;
  const selectedPublisher = selectedPublisherFromState ?? defaultPublisher ?? null;
  const activePublisherId = selectedPublisher?.publisher._id ?? "";

  const skillsQueryArgs =
    selectedPublisher?.publisher.kind === "user" && me?._id
      ? { ownerUserId: me._id }
      : activePublisherId
        ? { ownerPublisherId: activePublisherId as Doc<"publishers">["_id"] }
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
    activePublisherId
      ? { ownerPublisherId: activePublisherId as Doc<"publishers">["_id"], limit: 100 }
      : me?._id
        ? { ownerUserId: me._id, limit: 100 }
        : "skip",
  ) as DashboardPackage[] | undefined;

  if (isAuthLoading) {
    return <DashboardSkeleton />;
  }

  if (!isAuthenticated || !me) {
    return <SignInPrompt title="Sign in to access your dashboard." />;
  }

  const skills = mySkills ?? [];
  const packages = myPackages ?? [];
  const isLoading =
    publishers === undefined || skillsStatus === "LoadingFirstPage" || myPackages === undefined;
  const ownerHandle =
    selectedPublisher?.publisher.handle ?? me.handle ?? me.name ?? me.displayName ?? me._id;
  const isDashboardEmpty = !isLoading && skills.length === 0 && packages.length === 0;

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  const publisherSelector =
    publishers && publishers.length > 1 ? (
      <div className="dashboard-publisher-select">
        <span className="text-sm font-medium text-muted-foreground">Viewing as</span>
        <Select value={activePublisherId} onValueChange={setSelectedPublisherId}>
          <SelectTrigger
            aria-label="Dashboard publisher"
            className="min-w-[220px] rounded-[var(--radius-sm)]"
          >
            <SelectValue placeholder="Select publisher" />
          </SelectTrigger>
          <SelectContent>
            {publishers.map((entry) => (
              <SelectItem key={entry.publisher._id} value={entry.publisher._id}>
                @{entry.publisher.handle} · {entry.publisher.kind === "org" ? "Org" : "Personal"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    ) : null;

  // Welcome state for new users with no content
  if (isDashboardEmpty) {
    return (
      <main className="section">
        <div className="empty-state">
          <h1 className="empty-state-title text-[1.4rem] font-[family-name:var(--font-display)]">
            Welcome to ClawHub
          </h1>
          <p className="empty-state-body">
            You're signed in as @{ownerHandle}. Import a public GitHub repo or publish manually.
          </p>
          {publisherSelector}
          <div className="flex flex-wrap gap-3 justify-center">
            <Button asChild variant="primary">
              <Link to="/import" search={{ ownerHandle: undefined }}>
                <Download className="h-4 w-4" aria-hidden="true" />
                Import from GitHub
              </Link>
            </Button>
            <Button asChild>
              <Link to="/skills/publish" search={{ updateSlug: undefined, ownerHandle }}>
                Publish manually
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
        {publisherSelector}
      </div>

      <div className="dashboard-owner-grid">
        <section className="dashboard-collection-block">
          <div className="dashboard-section-header">
            <h2 className="dashboard-collection-title">Skills</h2>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline" className="dashboard-section-action">
                <Link to="/import" search={{ ownerHandle: undefined }}>
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Import from GitHub
                </Link>
              </Button>
              <Button asChild size="sm" className="dashboard-section-action">
                <Link to="/skills/publish" search={{ updateSlug: undefined, ownerHandle }}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New Skill
                </Link>
              </Button>
            </div>
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

function SkillRow({ skill, ownerHandle }: { skill: DashboardSkill; ownerHandle: string }) {
  const status = skillArtifactStatus(skill);
  const titleId = `dashboard-skill-title-${skill._id}`;
  const detailHref =
    skill.detailHref ??
    buildSkillHref(ownerHandle, skill.ownerPublisherId ?? skill.ownerUserId ?? null, skill.slug);
  const settingsHref = skill.settingsHref ?? `${detailHref}/settings`;
  const stats = [
    { label: "Downloads", value: formatCompactNumber(skill.stats?.downloads ?? 0) },
    { label: "Current version", value: formatVersion(skill.latestVersion?.version) },
    { label: "Last updated", value: formatShortDate(skill.updatedAt) },
  ];

  return (
    <ArtifactCard
      href={detailHref}
      title={skill.displayName}
      titleId={titleId}
      icon={<Box className="h-5 w-5" />}
      status={status}
      stats={stats}
      actions={
        <SettingsLink href={settingsHref} label={`Open settings for ${skill.displayName}`} />
      }
    />
  );
}

function PackageRow({ pkg }: { pkg: DashboardPackage }) {
  const status = packageArtifactStatus(pkg);
  const detailHref = buildPluginDetailHref(pkg.name);
  const validationCount = pkg.inspectorWarningCount ?? 0;
  const titleId = `dashboard-package-title-${pkg._id}`;
  const stats = [
    { label: "Downloads", value: formatCompactNumber(pkg.stats.downloads ?? 0) },
    { label: "Current version", value: formatVersion(pkg.latestVersion) },
    { label: "Last updated", value: formatShortDate(pkg.updatedAt) },
  ];

  return (
    <ArtifactCard
      href={detailHref}
      title={pkg.displayName}
      titleId={titleId}
      icon={<Package className="h-5 w-5" />}
      status={status}
      stats={stats}
      actions={
        validationCount > 0 ? (
          <div className="dashboard-row-action">
            <Button asChild variant="ghost" size="sm">
              <a
                href={buildPluginValidationHref(pkg.name)}
                aria-label={`View ${validationCount} validation findings for ${pkg.displayName}`}
                title="Validation"
              >
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {validationCount}
              </a>
            </Button>
          </div>
        ) : null
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

function formatVersion(version: string | null | undefined) {
  return version ? `v${version}` : "Unknown";
}

function SettingsLink({ href, label }: { href: string; label: string }) {
  return (
    <div className="dashboard-row-action">
      <Button asChild variant="ghost" size="icon-sm">
        <a href={href} aria-label={label} title="Settings">
          <Settings className="h-4 w-4" aria-hidden="true" />
        </a>
      </Button>
    </div>
  );
}
