import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  Clock,
  GitBranch,
  Package,
  Plug,
  ShieldCheck,
  Star,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import semver from "semver";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { EmptyState } from "../components/EmptyState";
import { Container } from "../components/layout/Container";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
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

  if (!me) {
    return (
      <Container className="py-10">
        <Card>
          <CardContent>Sign in to access your dashboard.</CardContent>
        </Card>
      </Container>
    );
  }

  const skills = mySkills ?? [];
  const packages = myPackages ?? [];
  const ownerHandle =
    selectedPublisher?.publisher.handle ?? me.handle ?? me.name ?? me.displayName ?? me._id;

  return (
    <Container className="py-10">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-1.5">
          <h1 className="font-display text-2xl font-bold text-[color:var(--ink)]">
            Publisher Dashboard
          </h1>
          <p className="text-sm text-[color:var(--ink-soft)]">
            Owner-only view for skills and plugins, including security scans and verification.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {publishers && publishers.length > 0 ? (
            <select
              className="min-h-[44px] rounded-[var(--radius-pill)] border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-[11px] text-sm text-[color:var(--ink)] transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35"
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
          <Button asChild variant="primary">
            <Link to="/publish-skill" search={{ updateSlug: undefined }}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Publish Skill
            </Link>
          </Button>
          <Button asChild>
            <Link to="/publish-plugin" search={{ ...emptyPluginPublishSearch, ownerHandle }}>
              <Plug className="h-4 w-4" aria-hidden="true" />
              Publish Plugin
            </Link>
          </Button>
        </div>
      </div>

      {/* Owner panel */}
      <Card>
        <CardContent>
          <div className="grid gap-10">
            {/* Skills section */}
            <section className="flex flex-col gap-4">
              <div>
                <h2 className="font-display text-lg font-bold text-[color:var(--ink)]">
                  Publisher Skills
                </h2>
                <p className="mt-1.5 text-sm text-[color:var(--ink-soft)]">
                  Hidden skill versions remain visible here while checks are pending.
                </p>
              </div>
              {skills.length === 0 ? (
                <EmptyState
                  icon={Upload}
                  title="No skills yet."
                  description="Publish your first skill to share it with the community."
                >
                  <Button asChild variant="primary">
                    <Link to="/publish-skill" search={{ updateSlug: undefined }}>
                      <Upload className="h-4 w-4" aria-hidden="true" />
                      Publish Skill
                    </Link>
                  </Button>
                </EmptyState>
              ) : (
                <div className="flex flex-col">
                  <div className="hidden grid-cols-[2fr_2fr_1.5fr_auto] gap-4 border-b border-[color:var(--line)] px-4 pb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--ink-soft)] md:grid">
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
            </section>

            {/* Plugins section */}
            <section className="flex flex-col gap-4">
              <div>
                <h2 className="font-display text-lg font-bold text-[color:var(--ink)]">
                  Publisher Plugins
                </h2>
                <p className="mt-1.5 text-sm text-[color:var(--ink-soft)]">
                  Owner-only package view with VirusTotal, static scan, and verification state.
                </p>
              </div>
              {packages.length === 0 ? (
                <EmptyState
                  icon={Plug}
                  title="No plugins yet."
                  description="Publish your first plugin release to validate and distribute it."
                >
                  <Button asChild variant="primary">
                    <Link
                      to="/publish-plugin"
                      search={{ ...emptyPluginPublishSearch, ownerHandle }}
                    >
                      <Plug className="h-4 w-4" aria-hidden="true" />
                      Publish Plugin
                    </Link>
                  </Button>
                </EmptyState>
              ) : (
                <div className="flex flex-col">
                  <div className="hidden grid-cols-[2fr_2fr_1.5fr_auto] gap-4 border-b border-[color:var(--line)] px-4 pb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--ink-soft)] md:grid">
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
        </CardContent>
      </Card>
    </Container>
  );
}

function SkillRow({ skill, ownerHandle }: { skill: DashboardSkill; ownerHandle: string | null }) {
  return (
    <div className="grid items-start gap-4 border-b border-[color:var(--line)] px-4 py-4 last:border-b-0 md:grid-cols-[2fr_2fr_1.5fr_auto]">
      {/* Primary info */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/$owner/$slug"
            params={{ owner: ownerHandle ?? "unknown", slug: skill.slug }}
            className="font-display text-sm font-bold text-[color:var(--ink)] hover:text-[color:var(--accent)]"
          >
            {skill.displayName}
          </Link>
          <span className="font-mono text-xs text-[color:var(--ink-soft)]">/{skill.slug}</span>
          {skill.pendingReview ? (
            <Badge variant="pending">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Pending checks
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[color:var(--ink-soft)]">
          <span className="inline-flex items-center gap-1">
            <ArrowDownToLine size={13} aria-hidden="true" />{" "}
            {formatCompactStat(skill.stats.downloads)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Star size={13} aria-hidden="true" /> {formatCompactStat(skill.stats.stars)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Package size={13} aria-hidden="true" /> {skill.stats.versions}
          </span>
        </div>
      </div>

      {/* Summary */}
      <div className="text-sm text-[color:var(--ink-soft)]">
        {skill.summary ?? "No summary provided."}
      </div>

      {/* Status */}
      <div className="flex flex-col gap-1 text-xs text-[color:var(--ink-soft)]">
        {skill.pendingReview ? (
          <>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck size={13} aria-hidden="true" />
              VT pending
            </span>
            <span className="text-[color:var(--ink-soft)]">
              Hidden until verification checks finish.
            </span>
          </>
        ) : (
          <span>Visible</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to="/publish-skill" search={{ updateSlug: skill.slug }}>
            <Upload className="h-3 w-3" aria-hidden="true" />
            New Version
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/$owner/$slug" params={{ owner: ownerHandle ?? "unknown", slug: skill.slug }}>
            View
          </Link>
        </Button>
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
  const variant =
    tone === "pending"
      ? "pending"
      : tone === "warning"
        ? "warning"
        : tone === "danger"
          ? "destructive"
          : tone === "success"
            ? "success"
            : "default";
  return <Badge variant={variant}>{label}</Badge>;
}

function PackageRow({ pkg, ownerHandle }: { pkg: DashboardPackage; ownerHandle: string }) {
  const scanLabel = scanStatusLabel(pkg.scanStatus);
  const nextVersion = pkg.latestVersion ? semver.inc(pkg.latestVersion, "patch") : null;
  const sourceLabel = pkg.sourceRepo
    ?.replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "");
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
    <div className="grid items-start gap-4 border-b border-[color:var(--line)] px-4 py-4 last:border-b-0 md:grid-cols-[2fr_2fr_1.5fr_auto]">
      {/* Primary info */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/plugins/$name"
            params={{ name: pkg.name }}
            className="font-display text-sm font-bold text-[color:var(--ink)] hover:text-[color:var(--accent)]"
          >
            {pkg.displayName}
          </Link>
          <span className="font-mono text-xs text-[color:var(--ink-soft)]">{pkg.name}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
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
        <div className="flex flex-wrap items-center gap-3 text-xs text-[color:var(--ink-soft)]">
          <span className="inline-flex items-center gap-1">
            <ArrowDownToLine size={13} aria-hidden="true" />{" "}
            {formatCompactStat(pkg.stats.downloads)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Star size={13} aria-hidden="true" /> {formatCompactStat(pkg.stats.stars)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Package size={13} aria-hidden="true" /> {pkg.stats.versions}
          </span>
          <span className="inline-flex items-center gap-1">
            <GitBranch size={13} aria-hidden="true" /> {pkg.latestVersion ?? "No tag"}
          </span>
          {pkg.runtimeId ? (
            <span className="inline-flex items-center gap-1">
              <Plug size={13} aria-hidden="true" /> {pkg.runtimeId}
            </span>
          ) : null}
          {sourceLabel ? (
            <span className="inline-flex items-center gap-1">
              <ShieldCheck size={13} aria-hidden="true" /> {sourceLabel}
            </span>
          ) : null}
        </div>
      </div>

      {/* Summary */}
      <div className="text-sm text-[color:var(--ink-soft)]">
        {pkg.summary ?? "No summary provided."}
      </div>

      {/* Status */}
      <div className="flex flex-col gap-1 text-xs text-[color:var(--ink-soft)]">
        <span className="inline-flex items-center gap-1">
          <ShieldCheck size={13} aria-hidden="true" />{" "}
          {releaseStatusLabel(
            "VT",
            pkg.latestRelease?.vtStatus,
            pkg.scanStatus === "pending" ? "pending" : "unknown",
          )}
        </span>
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 size={13} aria-hidden="true" />{" "}
          {releaseStatusLabel("LLM", pkg.latestRelease?.llmStatus)}
        </span>
        <span className="inline-flex items-center gap-1">
          <AlertTriangle size={13} aria-hidden="true" />{" "}
          {releaseStatusLabel("Static", pkg.latestRelease?.staticScanStatus)}
        </span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
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
          >
            <Upload className="h-3 w-3" aria-hidden="true" />
            New Release
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/plugins/$name" params={{ name: pkg.name }}>
            View
          </Link>
        </Button>
      </div>
    </div>
  );
}
