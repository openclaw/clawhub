export type GitHubHandoffBlock = { status: 403 | 409 | 410 | 423; message: string };

export type GitHubHandoffTarget = {
  installKind: "github";
  repo: string | null;
  path: string | null;
  commit: string | null;
  contentHash: string | null;
  currentStatus: "present" | "missing" | "unknown" | null;
  scanStatus: "clean" | "suspicious" | "malicious" | "pending" | "failed" | null;
  removedAt: number | null;
} | null;

export type ReadyGitHubHandoffTarget = {
  installKind: "github";
  repo: string;
  path: string;
  commit: string;
  contentHash: string;
  currentStatus: "present";
  scanStatus: "clean" | "suspicious";
  removedAt: number | null;
};

type GitHubHandoffScanStatus = NonNullable<GitHubHandoffTarget>["scanStatus"];

export function getGitHubHandoffBlock(target: GitHubHandoffTarget): GitHubHandoffBlock | null {
  if (!target || target.installKind !== "github") {
    return {
      status: 409,
      message: "GitHub-backed skill source metadata is incomplete.",
    };
  }
  if (target.removedAt) {
    return {
      status: 410,
      message: "GitHub-backed skill has been removed upstream.",
    };
  }
  if (target.currentStatus === "missing") {
    return {
      status: 410,
      message: "GitHub-backed skill path is missing upstream.",
    };
  }
  if (target.scanStatus === "failed" || target.scanStatus === "malicious") {
    return {
      status: 403,
      message: "GitHub-backed skill failed ClawHub security scanning.",
    };
  }
  if (!target.repo || !target.path) {
    return {
      status: 409,
      message: "GitHub-backed skill source metadata is incomplete.",
    };
  }
  if (
    target.currentStatus !== "present" ||
    !target.commit ||
    !target.contentHash ||
    !isValidGitHubRepo(target.repo)
  ) {
    return {
      status: 423,
      message: "GitHub-backed skill needs an upstream freshness check before download.",
    };
  }
  if (!isSuccessfulGitHubHandoffScanStatus(target.scanStatus)) {
    return {
      status: 423,
      message: "GitHub-backed skill security scan is in progress.",
    };
  }
  return null;
}

export function isReadyGitHubHandoffTarget(
  target: GitHubHandoffTarget,
): target is ReadyGitHubHandoffTarget {
  return Boolean(
    target &&
    target.installKind === "github" &&
    target.repo &&
    target.path &&
    target.commit &&
    target.contentHash &&
    target.currentStatus === "present" &&
    isSuccessfulGitHubHandoffScanStatus(target.scanStatus) &&
    isValidGitHubRepo(target.repo),
  );
}

export function buildGitHubSkillHandoffDescriptor(target: ReadyGitHubHandoffTarget) {
  return {
    sourceRef: "public-github" as const,
    repo: target.repo,
    commit: target.commit,
    path: target.path,
    contentHash: target.contentHash,
    archiveUrl: buildGitHubZipballUrl(target.repo, target.commit),
  };
}

export function isSuccessfulGitHubHandoffScanStatus(scanStatus: GitHubHandoffScanStatus) {
  // Suspicious is review-worthy but not a hard public download block; pending,
  // failed, and malicious states still block handoff above.
  return scanStatus === "clean" || scanStatus === "suspicious";
}

function buildGitHubZipballUrl(repo: string, commit: string) {
  const [owner, name] = repo.split("/");
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    name,
  )}/zipball/${encodeURIComponent(commit)}`;
}

function isValidGitHubRepo(repo: string) {
  const [owner, name, ...rest] = repo.split("/");
  return Boolean(owner && name && rest.length === 0);
}
