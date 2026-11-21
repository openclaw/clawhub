const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

export function isGitHubHost(hostname: string) {
  return GITHUB_HOSTS.has(hostname);
}

export function decodeGitHubPathSegments(pathname: string) {
  return pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        throw new Error("Invalid GitHub URL");
      }
    });
}

export function normalizeGitHubRepo(value: string) {
  const trimmed = value
    .trim()
    .replace(/^git\+/, "")
    .replace(/\.git$/i, "")
    .replace(/^git@github\.com:/i, "https://github.com/");
  if (!trimmed) return undefined;

  const shorthand = trimmed.match(/^([a-z0-9_.-]+)\/([a-z0-9_.-]+)$/i);
  if (shorthand) return `${shorthand[1]}/${shorthand[2]}`;

  try {
    const url = new URL(trimmed);
    if (!isGitHubHost(url.hostname)) return undefined;
    const segments = decodeGitHubPathSegments(url.pathname);
    const owner = segments[0] ?? "";
    const repo = (segments[1] ?? "").replace(/\.git$/i, "");
    if (!owner || !repo) return undefined;
    return `${owner}/${repo}`;
  } catch {
    return undefined;
  }
}

export function resolveGitHubPublishSource(rawRepo: string, commit: string, ref?: string) {
  const repo = normalizeGitHubRepo(rawRepo);
  if (!repo) return undefined;
  return {
    kind: "github" as const,
    url: `https://github.com/${repo}`,
    repo,
    ref: ref || commit,
    commit,
  };
}
