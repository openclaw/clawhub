import { createFileRoute, Link } from "@tanstack/react-router";
import { usePaginatedQuery, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  Clock,
  GitBranch,
  Loader2,
  Package,
  Plug,
  Search,
  ShieldCheck,
  Star,
  Upload,
} from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import semver from "semver";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { formatCompactStat } from "../lib/numberFormat";
import { familyLabel } from "../lib/packageLabels";
import type { PublicSkill } from "../lib/publicUser";

const emptyPluginPublishSearch = {
  ownerHandle: undefined,
  name: undefined,
  displayName: undefined,
  family: undefined,
  nextVersion: undefined,
  sourceRepo: undefined,
} as const;

type DashboardSkill = PublicSkill & { pendingReview?: boolean };

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
  } | null;
};

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
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

  const [skillSearch, setSkillSearch] = useState("");
  const deferredSearch = useDeferredValue(skillSearch);
  const isSearching = Boolean(deferredSearch.trim());

  const baseOwnerArgs =
    selectedPublisher?.publisher.kind === "user" && me?._id
      ? { ownerUserId: me._id }
      : selectedPublisherId
        ? { ownerPublisherId: selectedPublisherId as Doc<"publishers">["_id"] }
        : me?._id
          ? { ownerUserId: me._id }
          : null;

  // Browse mode: paginated
  const {
    results: paginatedSkills,
    status: skillsStatus,
    loadMore,
  } = usePaginatedQuery(
    api.skills.listDashboardPaginated,
    !isSearching && baseOwnerArgs ? baseOwnerArgs : "skip",
    { initialNumItems: 50 },
  );

  // Search mode: server-side filter
  const searchResults = useQuery(
    api.skills.searchDashboard,
    isSearching && baseOwnerArgs
      ? { ...baseOwnerArgs, search: deferredSearch, limit: 200 }
      : "skip",
  ) as DashboardSkill[] | undefined;

  const mySkills = isSearching ? searchResults : (paginatedSkills as DashboardSkill[] | undefined);

  // Total published skill count (lightweight query for header)
  const totalSkillCount = useQuery(
    api.skills.countDashboard,
    baseOwnerArgs ?? "skip",
  );

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
    const personal = publishers?.find((entry) => entry.publisher.kind === "user") ?? publishers?.[0];
    if (personal?.publisher._id) {
      setSelectedPublisherId(personal.publisher._id);
    }
  }, [publishers, selectedPublisherId]);

  if (!me) {
    return (
      <main className="section">
        <div className="card">Sign in to access your dashboard.</div>
      </main>
    );
  }

  const skills = mySkills ?? [];
  const packages = myPackages ?? [];
  const ownerHandle =
    selectedPublisher?.publisher.handle ?? me.handle ?? me.name ?? me.displayName ?? me._id;

  return (
    <main className="section">
      <div className="dashboard-header">
        <div style={{ display: "grid", gap: "6px" }}>
          <h1 className="section-title" style={{ margin: 0 }}>
            Publisher Dashboard
          </h1>
          <p className="section-subtitle" style={{ margin: 0 }}>
            Owner-only view for skills and plugins, including security scans and verification.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {publishers && publishers.length > 0 ? (
            <select
              className="input"
              value={selectedPublisherId}
              onChange={(event) => setSelectedPublisherId(event.target.value)}
            >
              {publishers.map((entry) => (
                <option key={entry.publisher._id} value={entry.publisher._id}>
                  @{entry.publisher.handle} · {entry.role}
                </option>
              ))}
            </select>
          ) : null}
          <Link to="/publish-skill" search={{ updateSlug: undefined }} className="btn btn-primary">
            <Upload className="h-4 w-4" aria-hidden="true" />
            Publish Skill
          </Link>
          <Link
            to="/publish-plugin"
            search={{ ...emptyPluginPublishSearch, ownerHandle }}
            className="btn"
          >
            <Plug className="h-4 w-4" aria-hidden="true" />
            Publish Plugin
          </Link>
        </div>
      </div>

      <section className="card dashboard-owner-panel">
        <div className="dashboard-owner-grid">
          <section className="dashboard-collection-block">
            <div className="dashboard-section-header">
              <div>
                <h2 className="dashboard-collection-title">
                  Publisher Skills
                  {totalSkillCount != null && (
                    <span className="dashboard-collection-count">{totalSkillCount}</span>
                  )}
                </h2>
                <p className="section-subtitle" style={{ margin: "6px 0 0" }}>
                  Hidden skill versions remain visible here while checks are pending.
                </p>
              </div>
            </div>
            <div className="dashboard-toolbar">
              <div className="dashboard-search">
                <Search className="dashboard-search-icon" size={16} aria-hidden="true" />
                <input
                  className="dashboard-search-input"
                  type="text"
                  placeholder="Search skills by name or description..."
                  value={skillSearch}
                  onChange={(e) => setSkillSearch(e.target.value)}
                />
                {skillSearch && (
                  <button
                    className="dashboard-search-clear"
                    onClick={() => setSkillSearch("")}
                    aria-label="Clear search"
                  >
                    &times;
                  </button>
                )}
              </div>
            </div>
            {skills.length === 0 && !isSearching ? (
              <div className="dashboard-inline-empty">
                <div className="dashboard-inline-empty-copy">
                  <strong>No skills yet.</strong> Publish your first skill to share it with the community.
                </div>
                <Link to="/publish-skill" search={{ updateSlug: undefined }} className="btn btn-primary">
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Publish Skill
                </Link>
              </div>
            ) : skills.length === 0 && isSearching ? (
              <div className="dashboard-inline-empty">
                <div className="dashboard-inline-empty-copy">
                  No skills matching &ldquo;{deferredSearch}&rdquo;.
                </div>
              </div>
            ) : (
              <div className="dashboard-list">
                <div className="dashboard-list-header">
                  <span>Skill</span>
                  <span>Summary</span>
                  <span>Status</span>
                  <span>Actions</span>
                </div>
                {skills.map((skill) => (
                  <SkillRow key={skill._id} skill={skill} ownerHandle={ownerHandle} />
                ))}
              </div>
            )}
            {!isSearching && skillsStatus === "CanLoadMore" && (
              <div className="dashboard-load-more">
                <button className="btn" onClick={() => loadMore(50)}>
                  Load More
                </button>
              </div>
            )}
            {!isSearching && skillsStatus === "LoadingMore" && (
              <div className="dashboard-load-more">
                <Loader2 className="dashboard-spinner" size={20} />
                <span>Loading more skills...</span>
              </div>
            )}
          </section>

          <section className="dashboard-collection-block">
            <div className="dashboard-section-header">
              <div>
                <h2 className="dashboard-collection-title">Publisher Plugins</h2>
                <p className="section-subtitle" style={{ margin: "6px 0 0" }}>
                  Owner-only package view with VirusTotal, static scan, and verification state.
                </p>
              </div>
            </div>
            {packages.length === 0 ? (
              <div className="dashboard-inline-empty">
                <div className="dashboard-inline-empty-copy">
                  <strong>No plugins yet.</strong> Publish your first plugin release to validate and distribute it.
                </div>
                <Link
                  to="/publish-plugin"
                  search={{ ...emptyPluginPublishSearch, ownerHandle }}
                  className="btn btn-primary"
                >
                  <Plug className="h-4 w-4" aria-hidden="true" />
                  Publish Plugin
                </Link>
              </div>
            ) : (
              <div className="dashboard-list">
                <div className="dashboard-list-header">
                  <span>Plugin</span>
                  <span>Summary</span>
                  <span>Status</span>
                  <span>Actions</span>
                </div>
                {packages.map((pkg) => (
                  <PackageRow key={pkg._id} pkg={pkg} ownerHandle={ownerHandle} />
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function SkillRow({ skill, ownerHandle }: { skill: DashboardSkill; ownerHandle: string | null }) {
  return (
    <div className="dashboard-list-row">
      <div className="dashboard-list-primary">
        <div className="dashboard-list-title">
          <Link
            to="/$owner/$slug"
            params={{ owner: ownerHandle ?? "unknown", slug: skill.slug }}
            className="dashboard-skill-name"
          >
            {skill.displayName}
          </Link>
          <span className="dashboard-list-id">/{skill.slug}</span>
          {skill.pendingReview ? (
            <span className="tag tag-pending">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Pending checks
            </span>
          ) : null}
        </div>
        <div className="dashboard-inline-metrics">
          <span>
            <ArrowDownToLine size={13} aria-hidden="true" /> {formatCompactStat(skill.stats.downloads)}
          </span>
          <span>
            <Star size={13} aria-hidden="true" /> {formatCompactStat(skill.stats.stars)}
          </span>
          <span>
            <Package size={13} aria-hidden="true" /> {skill.stats.versions}
          </span>
        </div>
      </div>
      <div className="dashboard-list-summary">{skill.summary ?? "No summary provided."}</div>
      <div className="dashboard-list-status">
        {skill.pendingReview ? (
          <>
            <span className="dashboard-inline-status-item">
              <ShieldCheck size={13} aria-hidden="true" />
              VT pending
            </span>
            <span className="dashboard-inline-status-note">
              Hidden until verification checks finish.
            </span>
          </>
        ) : (
          <span className="dashboard-inline-status-note">Visible</span>
        )}
      </div>
      <div className="dashboard-row-actions">
        <Link to="/publish-skill" search={{ updateSlug: skill.slug }} className="btn btn-sm">
          <Upload className="h-3 w-3" aria-hidden="true" />
          New Version
        </Link>
        <Link
          to="/$owner/$slug"
          params={{ owner: ownerHandle ?? "unknown", slug: skill.slug }}
          className="btn btn-ghost btn-sm"
        >
          View
        </Link>
      </div>
    </div>
  );
}

function scanStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "pending":
      return "Pending scan";
    case "clean":
      return "Scan clean";
    case "suspicious":
      return "Suspicious";
    case "malicious":
      return "Blocked";
    case "not-run":
      return "Scan not run";
    default:
      return null;
  }
}

function releaseStatusLabel(
  label: string,
  status: string | null | undefined,
  emptyLabel = "not started",
) {
  return `${label}: ${status?.trim() ? status : emptyLabel}`;
}

function PackageStatusTag({
  label,
  tone,
}: {
  label: string;
  tone: "default" | "pending" | "warning" | "danger" | "success";
}) {
  const className =
    tone === "pending"
      ? "tag tag-pending"
      : tone === "warning"
        ? "tag dashboard-tag-warning"
        : tone === "danger"
          ? "tag dashboard-tag-danger"
          : tone === "success"
            ? "tag dashboard-tag-success"
            : "tag";
  return <span className={className}>{label}</span>;
}

function PackageRow({ pkg, ownerHandle }: { pkg: DashboardPackage; ownerHandle: string }) {
  const scanLabel = scanStatusLabel(pkg.scanStatus);
  const nextVersion = pkg.latestVersion ? semver.inc(pkg.latestVersion, "patch") : null;
  const sourceLabel = pkg.sourceRepo?.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  const scanTone =
    pkg.scanStatus === "pending"
      ? "pending"
      : pkg.scanStatus === "suspicious"
        ? "warning"
        : pkg.scanStatus === "malicious"
          ? "danger"
          : pkg.scanStatus === "clean"
            ? "success"
            : "default";
  const staticTone =
    pkg.latestRelease?.staticScanStatus === "suspicious"
      ? "warning"
      : pkg.latestRelease?.staticScanStatus === "malicious"
        ? "danger"
        : pkg.latestRelease?.staticScanStatus === "clean"
          ? "success"
          : "default";

  return (
    <div className="dashboard-list-row">
      <div className="dashboard-list-primary">
        <div className="dashboard-list-title">
          <Link to="/plugins/$name" params={{ name: pkg.name }} className="dashboard-skill-name">
            {pkg.displayName}
          </Link>
          <span className="dashboard-list-id">{pkg.name}</span>
        </div>
        <div className="dashboard-inline-tags">
          <PackageStatusTag label={familyLabel(pkg.family)} tone="default" />
          <PackageStatusTag label={pkg.channel} tone="default" />
          {scanLabel ? <PackageStatusTag label={scanLabel} tone={scanTone} /> : null}
          {pkg.verification?.tier ? (
            <PackageStatusTag label={pkg.verification.tier} tone="default" />
          ) : null}
          {pkg.latestRelease?.staticScanStatus ? (
            <PackageStatusTag
              label={`Static ${pkg.latestRelease.staticScanStatus}`}
              tone={staticTone}
            />
          ) : null}
        </div>
        <div className="dashboard-inline-metrics">
          <span>
            <ArrowDownToLine size={13} aria-hidden="true" /> {formatCompactStat(pkg.stats.downloads)}
          </span>
          <span>
            <Star size={13} aria-hidden="true" /> {formatCompactStat(pkg.stats.stars)}
          </span>
          <span>
            <Package size={13} aria-hidden="true" /> {pkg.stats.versions}
          </span>
          <span>
            <GitBranch size={13} aria-hidden="true" /> {pkg.latestVersion ?? "No tag"}
          </span>
          {pkg.runtimeId ? (
            <span>
              <Plug size={13} aria-hidden="true" /> {pkg.runtimeId}
            </span>
          ) : null}
          {sourceLabel ? (
            <span>
              <ShieldCheck size={13} aria-hidden="true" /> {sourceLabel}
            </span>
          ) : null}
        </div>
      </div>
      <div className="dashboard-list-summary">{pkg.summary ?? "No summary provided."}</div>
      <div className="dashboard-list-status">
        <span className="dashboard-inline-status-item">
          <ShieldCheck size={13} aria-hidden="true" />{" "}
          {releaseStatusLabel(
            "VT",
            pkg.latestRelease?.vtStatus,
            pkg.scanStatus === "pending" ? "pending" : "unknown",
          )}
        </span>
        <span className="dashboard-inline-status-item">
          <CheckCircle2 size={13} aria-hidden="true" />{" "}
          {releaseStatusLabel("LLM", pkg.latestRelease?.llmStatus)}
        </span>
        <span className="dashboard-inline-status-item">
          <AlertTriangle size={13} aria-hidden="true" />{" "}
          {releaseStatusLabel("Static", pkg.latestRelease?.staticScanStatus)}
        </span>
      </div>
      <div className="dashboard-row-actions">
        <Link
          to="/publish-plugin"
          search={{
            ownerHandle,
            name: pkg.name,
            displayName: pkg.displayName,
            family: pkg.family === "bundle-plugin" ? "bundle-plugin" : "code-plugin",
            nextVersion: nextVersion ?? undefined,
            sourceRepo: pkg.sourceRepo ?? undefined,
          }}
          className="btn btn-sm"
        >
          <Upload className="h-3 w-3" aria-hidden="true" />
          New Release
        </Link>
        <Link to="/plugins/$name" params={{ name: pkg.name }} className="btn btn-ghost btn-sm">
          View
        </Link>
      </div>
    </div>
  );
}
