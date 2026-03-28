/** Pure helpers shared by the publish-plugin route and its tests. */

export const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export type JsonRecord = Record<string, unknown>;

export type PluginPublishPrefill = {
  family?: "code-plugin" | "bundle-plugin";
  name?: string;
  displayName?: string;
  version?: string;
  sourceRepo?: string;
  bundleFormat?: string;
  hostTargets?: string;
};

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getStringList(value: unknown) {
  if (Array.isArray(value)) return value.map(getString).filter(Boolean) as string[];
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Normalise arbitrary repository / homepage strings to the canonical
 * `owner/repo` shorthand accepted by the publish form.
 *
 * Accepts:
 *   - `owner/repo` shorthands
 *   - Full HTTPS GitHub URLs (https://github.com/owner/repo)
 *   - SSH GitHub URLs (git@github.com:owner/repo.git)
 *   - git+ prefixed URLs and .git suffixes are stripped
 */
export function normalizeGitHubRepo(value: string): string | undefined {
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
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return undefined;
    const [owner, repo] = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (!owner || !repo) return undefined;
    return `${owner}/${repo}`;
  } catch {
    return undefined;
  }
}

/**
 * Probe a parsed `package.json` for a GitHub repository reference and return
 * the canonical `owner/repo` shorthand.  Checks `repository`, `homepage`,
 * and `bugs.url` in that priority order.
 */
export function extractSourceRepo(packageJson: JsonRecord | null): string | undefined {
  if (!packageJson) return undefined;
  const repository = packageJson.repository;
  if (typeof repository === "string") return normalizeGitHubRepo(repository);
  if (isRecord(repository) && typeof repository.url === "string") {
    return normalizeGitHubRepo(repository.url);
  }
  if (typeof packageJson.homepage === "string") return normalizeGitHubRepo(packageJson.homepage);
  if (isRecord(packageJson.bugs) && typeof packageJson.bugs.url === "string") {
    return normalizeGitHubRepo(packageJson.bugs.url);
  }
  return undefined;
}
