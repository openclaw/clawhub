import { fetchGitHubRepositoryIdentity } from "./githubActionsOidc";
import { buildGitHubApiHeaders } from "./githubAuth";
import { computeGitHubSkillFolderContentHash } from "./githubSkillSync";

const MAX_FILES = 100;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const MAX_BLOB_RESPONSE_BYTES = MAX_FILE_BYTES * 2 + 64 * 1024;
const MAX_COMMIT_RESPONSE_BYTES = 256 * 1024;
const MAX_TREE_RESPONSE_BYTES = 8 * 1024 * 1024;

type MirrorSource = {
  externalId: string;
  owner: string;
  repo: string;
  githubPath: string;
  githubCommit: string;
  sourceContentHash: string;
};

type GitHubTreeEntry = {
  path?: unknown;
  type?: unknown;
  sha?: unknown;
  size?: unknown;
};

function decodeBase64(value: string) {
  const decoded = atob(value.replace(/\s+/g, ""));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function sha256Hex(bytes: Uint8Array) {
  const input = Uint8Array.from(bytes);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", input)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readBoundedJson(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("GitHub source response is too large");
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error("GitHub source response is too large");
    }
    return JSON.parse(text) as Record<string, unknown>;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error("GitHub source response is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  maxBytes?: number,
) {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) throw new Error(`GitHub source fetch failed with HTTP ${response.status}`);
  return maxBytes ? readBoundedJson(response, maxBytes) : response.json();
}

function contentType(path: string) {
  if (/\.md$/i.test(path)) return "text/markdown";
  if (/\.(json|jsonc)$/i.test(path)) return "application/json";
  if (/\.(ya?ml)$/i.test(path)) return "application/yaml";
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|rb|sh|txt)$/i.test(path)) return "text/plain";
  return "application/octet-stream";
}

export async function fetchExactSkillsShAdoptionSource(
  source: MirrorSource,
  fetchImpl: typeof fetch = fetch,
) {
  const repositoryIdentity = await fetchGitHubRepositoryIdentity(
    `${source.owner}/${source.repo}`,
    fetchImpl,
  );
  const canonicalRepository = repositoryIdentity.repository.toLowerCase();
  const expectedCommit = source.githubCommit.trim().toLowerCase();
  const expectedContentHash = source.sourceContentHash.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(expectedCommit) || !/^[a-f0-9]{64}$/.test(expectedContentHash)) {
    throw new Error("Mirrored skills.sh source is missing immutable GitHub provenance");
  }

  const headers = await buildGitHubApiHeaders({
    userAgent: "clawhub/skills-sh-adoption",
    allowAnonymous: false,
    useGitHubApp: false,
    fetchImpl,
  });
  const commit = await fetchJson(
    `https://api.github.com/repos/${canonicalRepository}/git/commits/${expectedCommit}`,
    headers,
    fetchImpl,
    MAX_COMMIT_RESPONSE_BYTES,
  );
  const commitSha = typeof commit.sha === "string" ? commit.sha.toLowerCase() : "";
  const tree = commit.tree as Record<string, unknown> | undefined;
  const treeSha = typeof tree?.sha === "string" ? tree.sha : "";
  if (commitSha !== expectedCommit || !treeSha) {
    throw new Error("Mirrored skills.sh commit no longer resolves to the frozen source");
  }

  const treePayload = await fetchJson(
    `https://api.github.com/repos/${canonicalRepository}/git/trees/${treeSha}?recursive=1`,
    headers,
    fetchImpl,
    MAX_TREE_RESPONSE_BYTES,
  );
  if (treePayload.truncated !== false || !Array.isArray(treePayload.tree)) {
    throw new Error("GitHub returned an incomplete skills.sh source tree");
  }
  const rawRoot = source.githubPath.trim().replace(/^\/+|\/+$/g, "");
  const root = rawRoot === "." ? "" : rawRoot;
  const sourcePath = rawRoot || ".";
  const prefix = root ? `${root}/` : "";
  const blobs = (treePayload.tree as GitHubTreeEntry[])
    .filter(
      (entry) =>
        entry.type === "blob" &&
        typeof entry.path === "string" &&
        (root ? entry.path.startsWith(prefix) : true),
    )
    .sort((left, right) => String(left.path).localeCompare(String(right.path)));
  if (blobs.length < 1 || blobs.length > MAX_FILES) {
    throw new Error("Mirrored skills.sh folder has an unsupported file count");
  }

  const repoEntries: Record<string, Uint8Array> = {};
  const files: Array<{
    path: string;
    bytes: Uint8Array;
    sha256: string;
    contentType: string;
  }> = [];
  let totalBytes = 0;
  for (const blob of blobs) {
    const repoPath = String(blob.path);
    const sha = typeof blob.sha === "string" ? blob.sha : "";
    if (!sha) throw new Error(`GitHub tree entry is missing a blob SHA: ${repoPath}`);
    if (typeof blob.size === "number" && Number.isFinite(blob.size) && blob.size > MAX_FILE_BYTES) {
      throw new Error(`Mirrored skills.sh file is too large: ${repoPath}`);
    }
    const payload = await fetchJson(
      `https://api.github.com/repos/${canonicalRepository}/git/blobs/${sha}`,
      headers,
      fetchImpl,
      MAX_BLOB_RESPONSE_BYTES,
    );
    if (payload.encoding !== "base64" || typeof payload.content !== "string") {
      throw new Error(`GitHub returned invalid blob content: ${repoPath}`);
    }
    const bytes = decodeBase64(payload.content);
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(`Mirrored skills.sh file is too large: ${repoPath}`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Mirrored skills.sh folder is too large");
    repoEntries[repoPath] = bytes;
    files.push({
      path: root ? repoPath.slice(prefix.length) : repoPath,
      bytes,
      sha256: await sha256Hex(bytes),
      contentType: contentType(repoPath),
    });
  }

  const contentHash = await computeGitHubSkillFolderContentHash(repoEntries, root);
  if (contentHash !== expectedContentHash) {
    throw new Error("Mirrored skills.sh folder content changed from the synchronized hash");
  }
  const manifest = files.map((file) => `${file.path}\0${file.sha256}\n`).join("");
  return {
    externalId: source.externalId,
    repository: canonicalRepository,
    repositoryOwnerId: Number(repositoryIdentity.repositoryOwnerId),
    repositoryOwner: repositoryIdentity.repositoryOwner,
    githubPath: sourcePath,
    githubCommit: commitSha,
    sourceContentHash: contentHash,
    artifactContentHash: await sha256Hex(new TextEncoder().encode(manifest)),
    files,
  };
}
