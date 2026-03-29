import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const GITHUB_API = "https://api.github.com";
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const ZIP_USER_AGENT = "clawhub/package-publish";

export type ResolvedPublishSource =
  | {
      kind: "local";
      path: string;
    }
  | {
      kind: "github";
      owner: string;
      repo: string;
      ref?: string;
      path: string;
      url: string;
    };

export type LocalGitInfo = {
  root: string;
  path: string;
  repo?: string;
  commit?: string;
  ref?: string;
};

export type FetchedGitHubSource = {
  dir: string;
  source: {
    kind: "github";
    url: string;
    repo: string;
    ref: string;
    commit: string;
    path: string;
    importedAt: number;
  };
  cleanup: () => Promise<void>;
};

export async function resolveSourceInput(
  input: string,
  options: { workdir: string },
): Promise<ResolvedPublishSource> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Path required");

  if (trimmed.startsWith("https://")) {
    return parseGitHubUrl(trimmed);
  }

  const shorthand = parseGitHubShorthand(trimmed);
  if (shorthand) {
    const localPath = resolveLocalPath(options.workdir, trimmed);
    const localStat = await stat(localPath).catch(() => null);
    if (localStat?.isDirectory()) {
      return { kind: "local", path: localPath };
    }
    return shorthand;
  }

  return { kind: "local", path: resolveLocalPath(options.workdir, trimmed) };
}

export async function fetchGitHubSource(source: Extract<ResolvedPublishSource, { kind: "github" }>) {
  const token = process.env.GITHUB_TOKEN?.trim() || undefined;
  const repo = `${source.owner}/${source.repo}`;
  const repoUrl = `https://github.com/${repo}`;
  const resolvedRef = source.ref?.trim() || (await resolveDefaultBranch(source.owner, source.repo, token));
  const commit = await resolveCommitSha(source.owner, source.repo, resolvedRef, token);
  const archiveBytes = await downloadGitHubZip(source.owner, source.repo, commit, token);
  const entries = stripSingleTopLevelFolder(unzipSync(archiveBytes));
  const publishPath = normalizeRepoSubpath(source.path);
  const tempDir = await mkdtemp(join(tmpdir(), "clawhub-github-publish-"));

  try {
    const subdirEntries = filterEntriesForSubpath(entries, publishPath);
    if (Object.keys(subdirEntries).length === 0) {
      throw new Error(`GitHub path "${publishPath}" does not contain any files`);
    }
    await writeEntries(tempDir, subdirEntries);
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  return {
    dir: tempDir,
    source: {
      kind: "github" as const,
      url: repoUrl,
      repo,
      ref: resolvedRef,
      commit,
      path: publishPath,
      importedAt: Date.now(),
    },
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  } satisfies FetchedGitHubSource;
}

export function resolveLocalGitInfo(folder: string): LocalGitInfo | null {
  const root = runGit(folder, ["rev-parse", "--show-toplevel"]);
  if (!root) return null;

  const prefix = runGit(folder, ["rev-parse", "--show-prefix"]);
  const commit = runGit(folder, ["rev-parse", "HEAD"]) || undefined;
  const ref =
    runGit(folder, ["describe", "--tags", "--exact-match"]) ||
    runGit(folder, ["branch", "--show-current"]) ||
    commit;
  const repo = normalizeGitHubRepo(runGit(folder, ["remote", "get-url", "origin"]) || "");

  return {
    root: root,
    path: normalizePath(prefix || "") || ".",
    repo: repo || undefined,
    commit,
    ref: ref || undefined,
  };
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
    if (!GITHUB_HOSTS.has(url.hostname)) return undefined;
    const segments = decodePathSegments(url.pathname);
    const owner = segments[0] ?? "";
    const repo = (segments[1] ?? "").replace(/\.git$/i, "");
    if (!owner || !repo) return undefined;
    return `${owner}/${repo}`;
  } catch {
    return undefined;
  }
}

function parseGitHubShorthand(input: string): Extract<ResolvedPublishSource, { kind: "github" }> | null {
  const atIndex = input.lastIndexOf("@");
  const rawRepo = atIndex > 0 ? input.slice(0, atIndex) : input;
  const rawRef = atIndex > 0 ? input.slice(atIndex + 1).trim() : "";
  if (
    !rawRepo ||
    rawRepo.startsWith(".") ||
    rawRepo.startsWith("~") ||
    rawRepo.startsWith("/") ||
    rawRepo.includes("\\")
  ) {
    return null;
  }
  const match = rawRepo.match(/^([a-z0-9_.-]+)\/([a-z0-9_.-]+)$/i);
  if (!match) return null;

  return {
    kind: "github",
    owner: match[1],
    repo: match[2],
    ...(rawRef ? { ref: rawRef } : {}),
    path: ".",
    url: `https://github.com/${match[1]}/${match[2]}`,
  };
}

function parseGitHubUrl(input: string): Extract<ResolvedPublishSource, { kind: "github" }> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid GitHub URL");
  }
  if (url.protocol !== "https:") throw new Error("Only https:// GitHub URLs are supported");
  if (!GITHUB_HOSTS.has(url.hostname)) throw new Error("Only github.com URLs are supported");

  const segments = decodePathSegments(url.pathname);
  const owner = segments[0] ?? "";
  const repo = (segments[1] ?? "").replace(/\.git$/i, "");
  if (!owner || !repo) throw new Error("GitHub URL must be /<owner>/<repo>");

  const kind = segments[2] ?? "";
  if (!kind || (kind !== "tree" && kind !== "blob")) {
    return {
      kind: "github",
      owner,
      repo,
      path: ".",
      url: `https://github.com/${owner}/${repo}`,
    };
  }

  const ref = segments[3] ?? "";
  if (!ref) throw new Error("Missing ref in GitHub URL");
  const rest = segments.slice(4).join("/");
  const normalizedPath = normalizeRepoSubpath(rest || ".");
  if (kind === "blob") {
    if (!rest) throw new Error("Missing path in GitHub URL");
    const parent = normalizeRepoSubpath(rest.split("/").slice(0, -1).join("/") || ".");
    return {
      kind: "github",
      owner,
      repo,
      ref,
      path: parent,
      url: `https://github.com/${owner}/${repo}`,
    };
  }

  return {
    kind: "github",
    owner,
    repo,
    ref,
    path: normalizedPath,
    url: `https://github.com/${owner}/${repo}`,
  };
}

function normalizeRepoSubpath(value: string) {
  const normalized = normalizePath(value.trim());
  if (!normalized || normalized === ".") return ".";
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid GitHub path");
  }
  return segments.join("/");
}

function resolveLocalPath(workdir: string, input: string) {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return resolve(homedir(), input.slice(2));
  return resolve(workdir, input);
}

function normalizePath(pathValue: string) {
  return pathValue
    .split(/[\\/]+/)
    .filter(Boolean)
    .join("/")
    .replace(/^\.\/+/, "");
}

function decodePathSegments(pathname: string) {
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

async function resolveDefaultBranch(owner: string, repo: string, token?: string) {
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: buildGitHubHeaders(token),
  });
  if (!response.ok) throw new Error(`GitHub repo not found: ${owner}/${repo}`);
  const parsed = (await response.json()) as { default_branch?: unknown };
  const defaultBranch =
    typeof parsed.default_branch === "string" ? parsed.default_branch.trim() : "";
  if (!defaultBranch) throw new Error("GitHub repo default branch missing");
  return defaultBranch;
}

async function resolveCommitSha(owner: string, repo: string, ref: string, token?: string) {
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
    {
      headers: buildGitHubHeaders(token),
    },
  );
  if (!response.ok) throw new Error(`GitHub ref not found: ${owner}/${repo}@${ref}`);
  const parsed = (await response.json()) as { sha?: unknown };
  const sha = typeof parsed.sha === "string" ? parsed.sha.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("GitHub commit sha missing");
  return sha;
}

async function downloadGitHubZip(owner: string, repo: string, ref: string, token?: string) {
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/zipball/${encodeURIComponent(ref)}`,
    {
      headers: buildGitHubHeaders(token),
    },
  );
  if (!response.ok) throw new Error(`GitHub archive download failed: ${owner}/${repo}@${ref}`);
  return new Uint8Array(await response.arrayBuffer());
}

function buildGitHubHeaders(token?: string) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": ZIP_USER_AGENT,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function stripSingleTopLevelFolder(entries: Record<string, Uint8Array>) {
  const paths = Object.keys(entries);
  if (paths.length === 0) return {};
  const firstRoot = paths[0]?.split("/")[0] ?? "";
  if (!firstRoot) return entries;
  const prefix = `${firstRoot}/`;
  if (!paths.every((path) => path.startsWith(prefix))) return entries;

  const stripped: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(entries)) {
    const next = path.slice(prefix.length);
    if (!next) continue;
    stripped[next] = bytes;
  }
  return stripped;
}

function filterEntriesForSubpath(entries: Record<string, Uint8Array>, subpath: string) {
  if (subpath === ".") return entries;
  const prefix = `${subpath}/`;
  const filtered: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(entries)) {
    if (!path.startsWith(prefix)) continue;
    const relPath = path.slice(prefix.length);
    if (!relPath) continue;
    filtered[relPath] = bytes;
  }
  return filtered;
}

async function writeEntries(root: string, entries: Record<string, Uint8Array>) {
  for (const [path, bytes] of Object.entries(entries)) {
    const absPath = join(root, ...path.split("/"));
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, Buffer.from(bytes));
  }
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return value || null;
}
