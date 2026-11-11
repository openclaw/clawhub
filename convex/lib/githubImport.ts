import { ConvexError } from "convex/values";
import { zipSync } from "fflate";
import semver from "semver";
import { fetchGitHubApi } from "./githubImportApi";
import { parseFrontmatter } from "./skills";

export type GitHubImportUrl = {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
  originalUrl: string;
};

export type GitHubImportResolved = {
  owner: string;
  repo: string;
  ref: string;
  commit: string;
  path: string;
  repoUrl: string;
  originalUrl: string;
};

export type GitHubImportCandidate = {
  path: string;
  readmePath: string;
  name?: string;
  description?: string;
};

export type GitHubImportFileEntry = {
  path: string;
  size: number;
  defaultSelected: boolean;
};

const MAX_REDIRECTS = 6;
const GITHUB_HOST = "github.com";
const CODELOAD_HOST = "codeload.github.com";
const SKILL_FILENAMES = new Set(["skill.md", "skills.md"]);

export function parseGitHubImportUrl(input: string): GitHubImportUrl {
  const rawUrl = input.trim();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "https:") throw new Error("Only https:// URLs are supported");
  if (url.hostname !== GITHUB_HOST) throw new Error("Only github.com URLs are supported");
  const originalUrl = canonicalGitHubImportUrl(url);

  const segments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        throw new Error("Invalid URL");
      }
    });

  const owner = segments[0] ?? "";
  const repo = (segments[1] ?? "").replace(/\.git$/, "");
  if (!owner || !repo) throw new Error("GitHub URL must be /<owner>/<repo>");

  const kind = segments[2] ?? "";
  if (!kind) return { owner, repo, originalUrl };
  if (kind !== "tree" && kind !== "blob") {
    return { owner, repo, originalUrl };
  }

  const ref = segments[3] ?? "";
  if (!ref) throw new Error("Missing ref in GitHub URL");

  const rest = segments.slice(4).join("/");
  const normalizedRest = normalizeRepoPath(rest);

  if (kind === "blob") {
    if (!rest) throw new Error("Missing path in GitHub URL");
    if (!normalizedRest) throw new Error("Invalid path in GitHub URL");
    if (!isGitHubSkillFilePath(normalizedRest)) {
      throw new Error("GitHub file URL must point to SKILL.md or skills.md");
    }
    const dir = normalizedRest.split("/").slice(0, -1).join("/");
    return { owner, repo, ref, path: dir || undefined, originalUrl };
  }

  if (rest && !normalizedRest) throw new Error("Invalid path in GitHub URL");
  return { owner, repo, ref, path: normalizedRest || undefined, originalUrl };
}

function canonicalGitHubImportUrl(url: URL) {
  return `https://${url.hostname}${url.pathname}`;
}

export async function resolveGitHubCommit(
  parsed: GitHubImportUrl,
  fetcher: typeof fetch,
): Promise<GitHubImportResolved> {
  const repoUrl = `https://${GITHUB_HOST}/${parsed.owner}/${parsed.repo}`;
  const ref = parsed.ref?.trim() || "HEAD";
  const path = normalizeRepoPath(parsed.path ?? "");

  const commit =
    ref === "HEAD"
      ? await resolveHeadCommit(parsed, fetcher)
      : await resolveRefCommit(parsed, ref, fetcher);

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    ref,
    commit,
    path,
    repoUrl,
    originalUrl: parsed.originalUrl,
  };
}

async function resolveRefCommit(parsed: GitHubImportUrl, ref: string, fetcher: typeof fetch) {
  const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${encodeURIComponent(ref)}`;
  let response: Response;
  try {
    response = await fetchGitHubApi(apiUrl, fetcher);
  } catch {
    // Never return upstream bodies, transport errors, or authentication details to the client.
    throw new ConvexError("Could not reach GitHub. Try again; your selections are kept.");
  }
  if (!response.ok) {
    if (
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" ||
          response.headers.has("retry-after")))
    ) {
      throw new ConvexError(
        "GitHub API rate limit exceeded. Wait a few minutes, then try again; your selections are kept.",
      );
    }
    if (response.status === 404 || response.status === 422) {
      throw new ConvexError(
        "GitHub branch or commit was not found. Return to Select skills and refresh your repositories.",
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new ConvexError(
        "GitHub authentication is temporarily unavailable. Try again later or contact ClawHub support.",
      );
    }
    throw new ConvexError(
      "GitHub is temporarily unavailable. Try again; your selections are kept.",
    );
  }
  const body = (await response.json().catch(() => null)) as { sha?: unknown } | null;
  const sha = typeof body?.sha === "string" ? body.sha : "";
  if (!/^[a-f0-9]{40}$/i.test(sha)) {
    throw new ConvexError(
      "GitHub returned an invalid commit. Try previewing again; your selections are kept.",
    );
  }
  return sha.toLowerCase();
}

async function resolveHeadCommit(parsed: GitHubImportUrl, fetcher: typeof fetch) {
  let url = `https://${GITHUB_HOST}/${parsed.owner}/${parsed.repo}/archive/HEAD.zip`;
  for (let i = 0; i < MAX_REDIRECTS; i += 1) {
    const response = await fetcher(url, {
      headers: buildGitHubImportHeaders(),
      redirect: "manual",
    });
    const location = response.headers.get("location");
    if (!location) break;
    const next = new URL(location, url);
    if (next.hostname !== GITHUB_HOST && next.hostname !== CODELOAD_HOST) {
      throw new Error("Unexpected redirect host");
    }
    url = next.toString();
  }

  const maybe = url.split("/").at(-1) ?? "";
  if (!/^[a-f0-9]{40}$/i.test(maybe)) {
    throw new Error("Could not resolve commit for HEAD");
  }
  return maybe.toLowerCase();
}

export async function fetchGitHubZipBytes(
  resolved: GitHubImportResolved,
  fetcher: typeof fetch,
  limits?: { maxZipBytes?: number },
): Promise<Uint8Array> {
  const maxZipBytes = limits?.maxZipBytes ?? 25 * 1024 * 1024;
  const url = `https://${CODELOAD_HOST}/${resolved.owner}/${resolved.repo}/zip/${resolved.commit}`;
  const response = await fetcher(url, {
    headers: buildGitHubImportHeaders(),
  });
  if (!response.ok) throw new Error("GitHub archive download failed");

  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader) {
    const contentLength = Number.parseInt(lengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxZipBytes) {
      throw new Error("GitHub archive too large");
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxZipBytes) throw new Error("GitHub archive too large");
    return buffer;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxZipBytes) throw new Error("GitHub archive too large");
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function buildGitHubImportHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "clawhub/github-import",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export type ZipEntryMap = Record<string, Uint8Array>;

export function buildGitHubZipForTests(entries: Record<string, string>) {
  const asBytes = Object.fromEntries(
    Object.entries(entries).map(([path, text]) => [path, new TextEncoder().encode(text)]),
  );
  return Uint8Array.from(zipSync(asBytes, { level: 1 }));
}

export function stripGitHubZipRoot(entries: ZipEntryMap): ZipEntryMap {
  const paths = Object.keys(entries);
  if (paths.length === 0) return {};
  const first = paths[0] ?? "";
  const firstRoot = first.split("/")[0] ?? "";
  if (!firstRoot) return entries;
  const prefix = `${firstRoot}/`;
  if (!paths.every((path) => path.startsWith(prefix))) return entries;
  const out: ZipEntryMap = {};
  for (const [path, data] of Object.entries(entries)) {
    const stripped = path.slice(prefix.length);
    if (!stripped) continue;
    out[stripped] = data;
  }
  return out;
}

export function detectGitHubImportCandidates(entries: ZipEntryMap): GitHubImportCandidate[] {
  const candidates: GitHubImportCandidate[] = [];
  for (const path of Object.keys(entries)) {
    const normalized = normalizeRepoPath(path);
    if (!isGitHubSkillFilePath(normalized)) continue;
    const dir = normalized.split("/").slice(0, -1).join("/");
    const readmePath = normalized;
    const raw = new TextDecoder().decode(entries[path] ?? new Uint8Array());
    const frontmatter = parseFrontmatter(raw);
    const name = typeof frontmatter.name === "string" ? frontmatter.name : undefined;
    const description =
      typeof frontmatter.description === "string" ? frontmatter.description : undefined;
    candidates.push({
      path: normalizeRepoPath(dir),
      readmePath,
      name: name?.trim() || undefined,
      description: description?.trim() || undefined,
    });
  }
  return uniqCandidates(candidates);
}

export function isGitHubSkillFilePath(path: string) {
  const normalized = normalizeRepoPath(path);
  const filename = normalized.split("/").at(-1)?.toLowerCase() ?? "";
  return SKILL_FILENAMES.has(filename);
}

function uniqCandidates(candidates: GitHubImportCandidate[]) {
  const seen = new Set<string>();
  const out: GitHubImportCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.path}::${candidate.readmePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function listFilesUnderCandidate(
  entries: ZipEntryMap,
  candidatePath: string,
): Array<{ path: string; bytes: Uint8Array }> {
  const root = normalizeCandidateRoot(candidatePath);
  const out: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const [path, bytes] of Object.entries(entries)) {
    const normalized = normalizeRepoPath(path);
    if (!isUnderRoot(normalized, root)) continue;
    out.push({ path: normalized, bytes });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function computeDefaultSelectedPaths(params: {
  candidate: GitHubImportCandidate;
  files: Array<{ path: string; bytes: Uint8Array }>;
}) {
  const candidateRoot = normalizeCandidateRoot(params.candidate.path);
  return params.files
    .map((file) => normalizeRepoPath(file.path))
    .filter((path) => path && isUnderRoot(path, candidateRoot))
    .sort();
}

export function buildGitHubImportFileList(params: {
  candidate: GitHubImportCandidate;
  files: Array<{ path: string; bytes: Uint8Array }>;
  defaultSelectedPaths: string[];
}): GitHubImportFileEntry[] {
  const selected = new Set(params.defaultSelectedPaths);
  return params.files.map((file) => ({
    path: file.path,
    size: file.bytes.byteLength,
    defaultSelected: selected.has(file.path),
  }));
}

export function normalizeRepoPath(path: string) {
  const stripped = path.replace(/^\/+/, "").trim();
  if (!stripped) return "";
  const cleaned = stripped.split("/").filter(Boolean).join("/");
  if (!cleaned || cleaned.includes("\\") || cleaned.includes("..")) return "";
  return cleaned;
}

export function normalizeCandidateRoot(candidatePath: string) {
  const normalized = normalizeRepoPath(candidatePath);
  return normalized ? `${normalized}/` : "";
}

function isUnderRoot(path: string, rootWithSlash: string) {
  if (!rootWithSlash) return true;
  return path === rootWithSlash.slice(0, -1) || path.startsWith(rootWithSlash);
}

export function suggestDisplayName(candidate: GitHubImportCandidate, fallbackBase: string) {
  const base = candidate.name?.trim() || fallbackBase.trim();
  if (!base) return "";
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function suggestVersion(latestVersion?: string | null) {
  const latest = latestVersion?.trim() || "";
  if (latest && semver.valid(latest)) {
    return semver.inc(latest, "patch") ?? "0.1.0";
  }
  return "0.1.0";
}
