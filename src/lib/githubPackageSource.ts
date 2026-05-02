type GitHubPackageSource = {
  repo: string;
  url: string;
  ref: string;
  commit: string;
  path: string;
};

type GitHubPackageSourceResult = {
  files: File[];
  source: GitHubPackageSource;
};

type Fetcher = typeof fetch;

type GitHubRepoResponse = {
  default_branch?: unknown;
};

type GitHubCommitResponse = {
  sha?: unknown;
  commit?: { tree?: { sha?: unknown } };
};

type GitHubTreeEntry = {
  path?: unknown;
  type?: unknown;
  sha?: unknown;
  size?: unknown;
};

type GitHubTreeResponse = {
  tree?: unknown;
  truncated?: unknown;
};

export type GitHubPackageSourceProgress = {
  phase: "resolving" | "listing" | "downloading";
  current?: number;
  total?: number;
  path?: string;
};

const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const DEFAULT_MAX_FILES = 500;
const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

type ParsedGitHubUrl = {
  owner: string;
  repo: string;
  kind: "repo" | "tree" | "blob";
  segments: string[];
  url: string;
};

export async function fetchGitHubPackageSource(
  input: string,
  options: {
    fetcher?: Fetcher;
    maxFiles?: number;
    maxFileBytes?: number;
    maxTotalBytes?: number;
    onProgress?: (progress: GitHubPackageSourceProgress) => void;
  } = {},
): Promise<GitHubPackageSourceResult> {
  const fetcher = options.fetcher ?? fetch;
  const parsed = parseGitHubPackageUrl(input);
  options.onProgress?.({ phase: "resolving" });

  const resolved = await resolveGitHubSource(parsed, fetcher);
  options.onProgress?.({ phase: "listing" });

  const entries = await listGitHubTreeFiles(parsed.owner, parsed.repo, resolved.treeSha, fetcher);
  const selected = filterGitHubTreeEntries(entries, resolved.path);
  if (selected.length === 0) {
    throw new Error(`GitHub path "${resolved.path}" does not contain package files.`);
  }

  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  if (selected.length > maxFiles) {
    throw new Error(
      `GitHub path has too many files (${selected.length}). Upload an archive instead.`,
    );
  }

  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const totalBytes = selected.reduce((sum, entry) => sum + entry.size, 0);
  if (selected.some((entry) => entry.size > maxFileBytes)) {
    throw new Error("One or more GitHub files exceeds the 10MB per-file limit.");
  }
  if (totalBytes > maxTotalBytes) {
    throw new Error("GitHub package exceeds the 50MB publish limit.");
  }

  const files: File[] = [];
  for (const [index, entry] of selected.entries()) {
    options.onProgress?.({
      phase: "downloading",
      current: index + 1,
      total: selected.length,
      path: entry.path,
    });
    const response = await fetcher(
      `${GITHUB_RAW}/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/${encodeURIComponent(
        resolved.commit,
      )}/${entry.path.split("/").map(encodeURIComponent).join("/")}`,
    );
    if (!response.ok) throw new Error(`Could not download ${entry.path} from GitHub.`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== entry.size && bytes.byteLength > maxFileBytes) {
      throw new Error(`GitHub file ${entry.path} exceeds the 10MB per-file limit.`);
    }
    files.push(
      new File([bytes], entry.relativePath, {
        type: response.headers.get("content-type")?.split(";")[0] ?? "",
      }),
    );
  }

  return {
    files,
    source: {
      repo: `${parsed.owner}/${parsed.repo}`,
      url: `https://github.com/${parsed.owner}/${parsed.repo}`,
      ref: resolved.ref,
      commit: resolved.commit,
      path: resolved.path,
    },
  };
}

function parseGitHubPackageUrl(input: string): ParsedGitHubUrl {
  const value = input.trim().replace(/^git@github\.com:/i, "https://github.com/");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Paste a GitHub repo, tree, or blob URL.");
  }
  if (url.protocol !== "https:" || !GITHUB_HOSTS.has(url.hostname)) {
    throw new Error("Paste a GitHub repo, tree, or blob URL.");
  }
  const segments = url.pathname
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean)
    .map(decodePathSegment);
  const [owner, repo, kind, ...rest] = segments;
  if (!owner || !repo) throw new Error("GitHub URL must include owner and repo.");
  if (kind && kind !== "tree" && kind !== "blob") {
    return { owner, repo, kind: "repo", segments: [], url: `https://github.com/${owner}/${repo}` };
  }
  return {
    owner,
    repo,
    kind: kind === "tree" || kind === "blob" ? kind : "repo",
    segments: rest,
    url: `https://github.com/${owner}/${repo}`,
  };
}

async function resolveGitHubSource(parsed: ParsedGitHubUrl, fetcher: Fetcher) {
  if (parsed.kind === "repo") {
    const defaultBranch = await fetchDefaultBranch(parsed.owner, parsed.repo, fetcher);
    const commit = await fetchCommit(parsed.owner, parsed.repo, defaultBranch, fetcher);
    return {
      ref: defaultBranch,
      commit: commit.sha,
      treeSha: commit.treeSha,
      path: ".",
    };
  }

  if (parsed.segments.length === 0) throw new Error("GitHub URL is missing a ref.");
  const minPathSegments = parsed.kind === "blob" ? 1 : 0;
  const maxRefSegments = parsed.segments.length - minPathSegments;
  for (let refSegmentCount = maxRefSegments; refSegmentCount >= 1; refSegmentCount -= 1) {
    const ref = parsed.segments.slice(0, refSegmentCount).join("/");
    const pathSegments = parsed.segments.slice(refSegmentCount);
    const candidate = await tryFetchCommit(parsed.owner, parsed.repo, ref, fetcher);
    if (!candidate) continue;
    const rawPath =
      parsed.kind === "blob" ? pathSegments.slice(0, -1).join("/") : pathSegments.join("/");
    return {
      ref,
      commit: candidate.sha,
      treeSha: candidate.treeSha,
      path: normalizeRepoPath(rawPath) || ".",
    };
  }

  throw new Error("GitHub ref not found.");
}

async function fetchDefaultBranch(owner: string, repo: string, fetcher: Fetcher) {
  const response = await githubJson(`${GITHUB_API}/repos/${owner}/${repo}`, fetcher);
  const parsed = (await response.json()) as GitHubRepoResponse;
  const branch = typeof parsed.default_branch === "string" ? parsed.default_branch.trim() : "";
  if (!branch) throw new Error("GitHub repo default branch missing.");
  return branch;
}

async function tryFetchCommit(owner: string, repo: string, ref: string, fetcher: Fetcher) {
  const response = await fetcher(
    `${GITHUB_API}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
    {
      headers: githubHeaders(),
    },
  );
  if (!response.ok) return null;
  return parseCommitResponse((await response.json()) as GitHubCommitResponse);
}

async function fetchCommit(owner: string, repo: string, ref: string, fetcher: Fetcher) {
  const response = await githubJson(
    `${GITHUB_API}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
    fetcher,
  );
  return parseCommitResponse((await response.json()) as GitHubCommitResponse);
}

function parseCommitResponse(parsed: GitHubCommitResponse) {
  const sha = typeof parsed.sha === "string" ? parsed.sha.trim().toLowerCase() : "";
  const treeSha =
    typeof parsed.commit?.tree?.sha === "string" ? parsed.commit.tree.sha.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^[a-f0-9]{40}$/.test(treeSha)) {
    throw new Error("GitHub commit metadata missing.");
  }
  return { sha, treeSha };
}

async function listGitHubTreeFiles(owner: string, repo: string, treeSha: string, fetcher: Fetcher) {
  const response = await githubJson(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
    fetcher,
  );
  const parsed = (await response.json()) as GitHubTreeResponse;
  if (parsed.truncated) throw new Error("GitHub tree is too large. Upload an archive instead.");
  if (!Array.isArray(parsed.tree)) throw new Error("GitHub tree metadata missing.");
  return parsed.tree
    .map(normalizeTreeEntry)
    .filter((entry): entry is { path: string; sha: string; size: number } => Boolean(entry));
}

function normalizeTreeEntry(entry: GitHubTreeEntry) {
  if (entry.type !== "blob") return null;
  const path = typeof entry.path === "string" ? normalizeRepoPath(entry.path) : "";
  const sha = typeof entry.sha === "string" ? entry.sha.trim() : "";
  const size = typeof entry.size === "number" ? entry.size : Number.NaN;
  if (!path || !/^[a-f0-9]{40}$/i.test(sha) || !Number.isFinite(size) || size < 0) return null;
  return { path, sha: sha.toLowerCase(), size };
}

function filterGitHubTreeEntries(
  entries: Array<{ path: string; sha: string; size: number }>,
  rootPath: string,
) {
  const root = normalizeRepoPath(rootPath);
  const prefix = root && root !== "." ? `${root}/` : "";
  return entries
    .filter((entry) => !prefix || entry.path.startsWith(prefix))
    .map((entry) => ({
      ...entry,
      relativePath: prefix ? entry.path.slice(prefix.length) : entry.path,
    }))
    .filter((entry) => entry.relativePath && !entry.relativePath.endsWith("/"))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function githubJson(url: string, fetcher: Fetcher) {
  const response = await fetcher(url, { headers: githubHeaders() });
  if (response.ok) return response;
  if (response.status === 403 || response.status === 429) {
    throw new Error("GitHub rate limit hit. Try again shortly or upload an archive.");
  }
  if (response.status === 404) throw new Error("GitHub repo or ref not found.");
  throw new Error("GitHub request failed.");
}

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function normalizeRepoPath(value: string) {
  if (value.trim() === ".") return ".";
  const parts = value
    .replaceAll("\u0000", "")
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("Invalid GitHub path.");
  }
  return parts.join("/");
}

function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new Error("Invalid GitHub URL.");
  }
}
