import { createHash } from "node:crypto";
import { fromBuffer, type ZipFile } from "yauzl";
import {
  fetchGitHubZipBytes,
  resolveGitHubCommit,
  stripGitHubZipRoot,
} from "../../convex/lib/githubImport";
import type { Snapshot } from "./contract";

const MAX_FILES = 7500;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
async function unpack(bytes: Uint8Array) {
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(Buffer.from(bytes), { lazyEntries: true }, (error, value) =>
      error ? reject(error) : resolve(value!),
    ),
  );
  const entries: Record<string, Uint8Array> = Object.create(null);
  let count = 0;
  let total = 0;
  return await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    const fail = (error: Error) => {
      zip.close();
      reject(error);
    };
    zip.on("error", fail);
    zip.on("end", () => resolve(stripGitHubZipRoot(entries)));
    zip.on("entry", (entry) => {
      const path = entry.fileName;
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (
        ++count > MAX_FILES * 2 ||
        entry.uncompressedSize > MAX_FILE_BYTES ||
        (total += entry.uncompressedSize) > MAX_TOTAL_BYTES
      )
        return fail(new Error("Upstream archive exceeds import limits"));
      if (
        (mode && mode !== 0o100000 && mode !== 0o040000) ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path.split("/").some((part: string) => part === "..") ||
        Object.hasOwn(entries, path)
      )
        return fail(new Error("Unsafe upstream archive entry"));
      if (path.endsWith("/")) {
        zip.readEntry();
        return;
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) return fail(error ?? new Error("Archive entry unavailable"));
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_FILE_BYTES) {
            stream.destroy(new Error("Archive file too large"));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("error", fail);
        stream.on("end", () => {
          entries[path] = Buffer.concat(chunks);
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
}
export async function fetchSnapshot(
  repo: string,
  ref: string,
  fetcher: typeof fetch = fetch,
): Promise<Snapshot> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error("Only explicit GitHub owner/repository sources are supported");
  const boundedFetch: typeof fetch = (input, init) =>
    fetcher(input, { ...init, redirect: "error", signal: AbortSignal.timeout(60_000) });
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "clawhub/company-plugins",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await boundedFetch(`https://api.github.com/repos/${repo}`, { headers });
  if (!response.ok)
    throw new Error(`Repository metadata returned HTTP ${response.status}: ${repo}`);
  const metadata = (await response.json()) as {
    id: number;
    owner: { id: number };
    private: boolean;
    archived: boolean;
    disabled: boolean;
    full_name: string;
  };
  if (
    metadata.private ||
    metadata.disabled ||
    metadata.full_name.toLowerCase() !== repo.toLowerCase()
  )
    throw new Error(`Source is private, disabled or renamed: ${repo}`);
  const [owner, name] = repo.split("/");
  const source = await resolveGitHubCommit(
    { owner, repo: name, ref, path: "", originalUrl: `https://github.com/${repo}` },
    boundedFetch,
  );
  const commitResponse = await boundedFetch(
    `https://api.github.com/repos/${repo}/commits/${source.commit}`,
    { headers },
  );
  if (!commitResponse.ok) throw new Error(`Commit metadata unavailable: ${repo}`);
  const commit = (await commitResponse.json()) as { commit: { committer: { date: string } } };
  const entries = await unpack(
    await fetchGitHubZipBytes(source, boundedFetch, { maxZipBytes: 50 * 1024 * 1024 }),
  );
  const files: Record<string, string> = Object.create(null);
  const fileHashes: Record<string, string> = Object.create(null);
  const fileSizes: Record<string, number> = Object.create(null);
  for (const [path, bytes] of Object.entries(entries)) {
    files[path] = Buffer.from(bytes).toString("utf8");
    fileSizes[path] = bytes.byteLength;
    fileHashes[path] = createHash("sha256").update(bytes).digest("hex");
  }
  return {
    repo: repo.toLowerCase(),
    repositoryId: metadata.id,
    ownerId: metadata.owner.id,
    commit: source.commit,
    updatedAt: commit.commit.committer.date,
    files,
    fileBytes: entries,
    fileHashes,
    fileSizes,
  };
}
