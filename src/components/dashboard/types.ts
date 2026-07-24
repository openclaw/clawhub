import type { Doc } from "../../../convex/_generated/dataModel";

export type DashboardSkill = Pick<
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
  | "moderationSummary"
  | "moderationVerdict"
  | "moderationFlags"
  | "isSuspicious"
  | "createdAt"
  | "updatedAt"
> & {
  ownerPath: string;
  detailHref?: string;
  settingsHref?: string;
  metricSources?: {
    clawHubDownloads: number;
    skillsShInstalls: number;
    openClawInstallsCurrent: number;
    openClawInstallsAllTime: number;
    githubStars: number;
    bookmarks: number;
  };
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

export type DashboardPackage = {
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
  topInspectorFinding?: {
    message: string;
    remediation?: string;
  };
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

export type DashboardPublisherEntry = {
  publisher: {
    _id: string;
    handle: string;
    displayName: string;
    kind: "user" | "org";
    image?: string | null;
  };
  role: "owner" | "admin" | "publisher";
};

export type DashboardKindFilter = "all" | "skill" | "plugin" | "attention";
export type DashboardSortKey = "name" | "downloads" | "updated";
export type DashboardSortDir = "asc" | "desc";
export type DashboardView = "list" | "grid";

export type DashboardAttentionItem = {
  id: string;
  kind: "skill" | "plugin";
  slug?: string;
  ownerHandle?: string;
  packageName?: string;
  version?: string;
  updatedAt?: number;
  issueType: "security" | "validation" | "quality" | "visibility";
  title: string;
  reason: string;
  preview?: string;
  severity: "destructive" | "warning" | "pending";
  href: string;
  actionLabel: string;
};

export type DashboardCatalogItem =
  | {
      kind: "skill";
      id: string;
      name: string;
      searchText: string;
      data: DashboardSkill;
      updatedAt: number;
      installs: number;
      downloads: number;
    }
  | {
      kind: "plugin";
      id: string;
      name: string;
      searchText: string;
      data: DashboardPackage;
      updatedAt: number;
      installs: number;
      downloads: number;
    };
