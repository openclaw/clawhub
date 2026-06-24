import {
  isSecurityScanStatusBlockedFromPublic,
  isSecurityScanStatusCompletedNonBlocked,
  type SourceBackedSkillScanStatus,
} from "./securityScanPolicy";

export type GitHubSkillScanStatus = SourceBackedSkillScanStatus;

export type GitHubCurrentStatus = "present" | "missing" | "unknown";

export type InstallResolverSkill = {
  slug: string;
  displayName: string;
  latestVersionSummary?: { version: string } | null;
  installKind?: "github";
  githubPath?: string;
  githubCurrentCommit?: string;
  githubCurrentContentHash?: string;
  githubCurrentStatus?: GitHubCurrentStatus;
  githubScanStatus?: GitHubSkillScanStatus;
  githubRemovedAt?: number;
};

export type InstallResolverSource = {
  repo: string;
  defaultBranch?: string | null;
};

export type SkillInstallResolution =
  | {
      ok: true;
      slug: string;
      installKind: "archive";
      archive: {
        version: string;
        downloadUrl: string;
      };
    }
  | {
      ok: true;
      slug: string;
      installKind: "github";
      github: {
        repo: string;
        path: string;
        commit: string;
        contentHash: string;
        sourceUrl: string;
      };
    }
  | {
      ok: false;
      slug: string;
      reason:
        | "archive_version_missing"
        | "github_source_missing"
        | "github_upstream_removed"
        | "github_upstream_missing"
        | "github_upstream_unknown"
        | "github_verification_pending"
        | "github_scan_failed";
      message: string;
      status: 403 | 409 | 410 | 423;
    };

export function buildSkillInstallResolution({
  origin,
  skill,
  source,
  ownerHandle,
  forceInstall = false,
}: {
  origin: string;
  skill: InstallResolverSkill;
  source: InstallResolverSource | null;
  ownerHandle?: string | null;
  forceInstall?: boolean;
}): SkillInstallResolution {
  if (skill.installKind !== "github") {
    const version = skill.latestVersionSummary?.version;
    if (!version) {
      return block(skill.slug, "archive_version_missing", 409);
    }

    const url = new URL("/api/v1/download", origin);
    url.searchParams.set("slug", skill.slug);
    if (ownerHandle) url.searchParams.set("ownerHandle", ownerHandle);
    url.searchParams.set("version", version);
    return {
      ok: true,
      slug: skill.slug,
      installKind: "archive",
      archive: {
        version,
        downloadUrl: url.toString(),
      },
    };
  }

  if (skill.githubRemovedAt) {
    return block(skill.slug, "github_upstream_removed", 410);
  }
  if (skill.githubCurrentStatus === "missing") {
    return block(skill.slug, "github_upstream_missing", 410);
  }
  if (isSecurityScanStatusBlockedFromPublic(skill.githubScanStatus)) {
    return block(skill.slug, "github_scan_failed", 403);
  }
  if (!source || !skill.githubPath) {
    return block(skill.slug, "github_source_missing", 409);
  }
  if (
    skill.githubCurrentStatus !== "present" ||
    !skill.githubCurrentCommit ||
    !skill.githubCurrentContentHash
  ) {
    return block(skill.slug, "github_upstream_unknown", 423);
  }
  if (
    !isSecurityScanStatusCompletedNonBlocked(skill.githubScanStatus) &&
    !(forceInstall && skill.githubScanStatus === "pending")
  ) {
    return block(skill.slug, "github_verification_pending", 423);
  }

  return {
    ok: true,
    slug: skill.slug,
    installKind: "github",
    github: {
      repo: source.repo,
      path: skill.githubPath,
      commit: skill.githubCurrentCommit,
      contentHash: skill.githubCurrentContentHash,
      sourceUrl: buildGitHubTreeUrl(source.repo, skill.githubCurrentCommit, skill.githubPath),
    },
  };
}

function block(
  slug: string,
  reason: Extract<SkillInstallResolution, { ok: false }>["reason"],
  status: Extract<SkillInstallResolution, { ok: false }>["status"],
): SkillInstallResolution {
  return {
    ok: false,
    slug,
    reason,
    status,
    message: INSTALL_BLOCK_MESSAGES[reason],
  };
}

const INSTALL_BLOCK_MESSAGES: Record<
  Extract<SkillInstallResolution, { ok: false }>["reason"],
  string
> = {
  archive_version_missing: "Hosted skill has no downloadable version.",
  github_source_missing: "GitHub-backed skill source metadata is incomplete.",
  github_upstream_removed: "GitHub-backed skill has been removed upstream.",
  github_upstream_missing: "GitHub-backed skill path is missing upstream.",
  github_upstream_unknown: "GitHub-backed skill needs an upstream freshness check before install.",
  github_verification_pending:
    "GitHub-backed skill security scan is in progress. Try again shortly, or rerun with --force-install to install the unverified upstream commit.",
  github_scan_failed: "GitHub-backed skill failed ClawHub security scanning.",
};

function buildGitHubTreeUrl(repo: string, commit: string, path: string) {
  return `https://github.com/${encodeURIComponentRepo(repo)}/tree/${commit}/${encodeURIComponentPath(
    path,
  )}`;
}

function encodeURIComponentRepo(repo: string) {
  return repo
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function encodeURIComponentPath(path: string) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
