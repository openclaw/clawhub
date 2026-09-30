"use node";

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import semver from "semver";

// Publish-time Plugin Inspector needs only the packed OpenClaw public surface:
// package.json plus dist/**/*.d.ts. The inspector's own target preparation
// buffers the full packument (~18 MB) and the whole npm archive, then extracts
// every file; OpenClaw 2026.9.x peaks above the 512 MiB Node action limit and
// unpacks to more than 300 MB of /tmp. Stream, verify, and keep only the surface.
const REGISTRY_URL = "https://registry.npmjs.org";
const TAR_BLOCK_BYTES = 512;
const METADATA_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 180_000;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_SELECTED_BYTES = 128 * 1024 * 1024;
const MAX_PAX_HEADER_BYTES = 1024 * 1024;
const TARGET_DIRECTORY = "openclaw";

type OpenClawTargetSurface = { status?: unknown; [key: string]: unknown };

type OpenClawInspectorTargetDeps = {
  readTargetSurface: (options: {
    rootDir: string;
    configuredPath: string;
  }) => Promise<OpenClawTargetSurface>;
  eligibilityVersion: (version: string) => string;
  fetch?: typeof fetch;
};

type ResolvedOpenClaw = {
  version: string;
  tarball: string;
  integrity: string | null;
  shasum: string | null;
  repository: unknown;
};

type SelectedEntry = { path: string; bytes: Uint8Array };

// Concurrent and warm invocations in one Node process share one download per target.
const preparedTargets = new Map<string, Promise<Record<string, unknown>>>();

export async function prepareOpenClawInspectorTarget(
  cacheRoot: string,
  deps: OpenClawInspectorTargetDeps,
) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const resolved = await resolveLatestOpenClaw(fetchImpl);
  const key = targetCacheKey(resolved);
  const memoKey = `${cacheRoot}\0${key}`;
  let prepared = preparedTargets.get(memoKey);
  if (!prepared) {
    prepared = buildTarget(cacheRoot, key, resolved, deps, fetchImpl);
    preparedTargets.set(memoKey, prepared);
    prepared.catch(() => preparedTargets.delete(memoKey));
  }
  return await prepared;
}

async function buildTarget(
  cacheRoot: string,
  key: string,
  resolved: ResolvedOpenClaw,
  deps: OpenClawInspectorTargetDeps,
  fetchImpl: typeof fetch,
) {
  const { packageDir, hit } = await ensurePackedSurface(cacheRoot, key, resolved, fetchImpl);
  const surface = await deps.readTargetSurface({ rootDir: packageDir, configuredPath: "." });
  if (surface.status !== "ok") {
    throw new Error(
      `prepared OpenClaw ${resolved.version} package has no readable public plugin surface`,
    );
  }
  return {
    ...surface,
    configuredPath: `npm:openclaw@${resolved.version}`,
    searchedPaths: [`npm:openclaw@${resolved.version}`],
    requestedVersion: "latest",
    version: resolved.version,
    eligibilityVersion: deps.eligibilityVersion(resolved.version),
    source: {
      type: "npm",
      package: "openclaw",
      registry: REGISTRY_URL,
      distTag: "latest",
      tarball: sanitizeUrl(resolved.tarball),
      integrity: resolved.integrity,
      shasum: resolved.shasum,
      repository: sanitizeRepository(resolved.repository),
    },
    cache: { hit, key },
  };
}

async function resolveLatestOpenClaw(fetchImpl: typeof fetch): Promise<ResolvedOpenClaw> {
  // The dist-tag document is one version (~100 KB), not the full packument.
  const response = await fetchImpl(`${REGISTRY_URL}/openclaw/latest`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`failed to resolve OpenClaw npm metadata: HTTP ${response.status}`);
  }
  const metadata = (await response.json()) as {
    name?: unknown;
    version?: unknown;
    dist?: { tarball?: unknown; integrity?: unknown; shasum?: unknown };
    repository?: unknown;
  };
  const version = typeof metadata.version === "string" ? metadata.version : "";
  if (
    metadata.name !== "openclaw" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ||
    semver.valid(version) !== version
  ) {
    throw new Error("OpenClaw npm dist-tag latest did not resolve to a valid exact version");
  }
  const tarball = metadata.dist?.tarball;
  if (typeof tarball !== "string" || !tarball.startsWith("https://")) {
    throw new Error(`OpenClaw npm metadata for ${version} is incomplete`);
  }
  const integrity =
    typeof metadata.dist?.integrity === "string" &&
    /^sha512-[A-Za-z0-9+/]+=*$/.test(metadata.dist.integrity)
      ? metadata.dist.integrity
      : null;
  const shasum =
    typeof metadata.dist?.shasum === "string" && /^[a-f0-9]{40}$/i.test(metadata.dist.shasum)
      ? metadata.dist.shasum.toLowerCase()
      : null;
  if (!integrity && !shasum) {
    throw new Error(`OpenClaw npm metadata for ${version} has no verifiable integrity metadata`);
  }
  return { version, tarball, integrity, shasum, repository: metadata.repository };
}

function targetCacheKey(resolved: ResolvedOpenClaw) {
  const identity = resolved.integrity ?? resolved.shasum ?? resolved.tarball;
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 12);
  return `${resolved.version}-${digest}`;
}

async function ensurePackedSurface(
  cacheRoot: string,
  key: string,
  resolved: ResolvedOpenClaw,
  fetchImpl: typeof fetch,
) {
  const targetsDir = path.join(cacheRoot, TARGET_DIRECTORY);
  const targetDir = path.join(targetsDir, key);
  const packageDir = path.join(targetDir, "package");
  if (await isPreparedPackage(packageDir, resolved.version)) return { packageDir, hit: true };

  const entries = await downloadPackedSurface(resolved, fetchImpl);
  await mkdir(targetsDir, { recursive: true });
  const temporaryDir = await mkdtemp(path.join(targetsDir, `.${key}-`));
  try {
    for (const entry of entries) {
      const destination = path.join(temporaryDir, ...entry.path.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, entry.bytes);
    }
    if (!(await isPreparedPackage(path.join(temporaryDir, "package"), resolved.version))) {
      throw new Error(
        `downloaded OpenClaw ${resolved.version} archive has unexpected package metadata`,
      );
    }
    try {
      await rename(temporaryDir, targetDir);
    } catch (error) {
      // A concurrent preparer already published the same verified target.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
    }
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
  // Targets are never pruned: another process may still be reading an older one,
  // and each is ~18 MB against sandboxes recycled far more often than OpenClaw ships.
  return { packageDir, hit: false };
}

async function isPreparedPackage(packageDir: string, version: string) {
  try {
    const packageJson = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
    return packageJson.name === "openclaw" && packageJson.version === version;
  } catch {
    return false;
  }
}

async function downloadPackedSurface(resolved: ResolvedOpenClaw, fetchImpl: typeof fetch) {
  const response = await fetchImpl(resolved.tarball, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    throw new Error(`failed to download OpenClaw ${resolved.version}: HTTP ${response.status}`);
  }
  const hash = createHash(resolved.integrity ? "sha512" : "sha1");
  const parser = createPackedSurfaceParser();
  let archiveBytes = 0;
  // Native zlib streams in bounded memory; fflate's streaming Gunzip retained
  // most of the ~400 MB inflated OpenClaw archive before it could be collected.
  await pipeline(
    Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
    async function* (source: AsyncIterable<Uint8Array>) {
      for await (const chunk of source) {
        archiveBytes += chunk.byteLength;
        if (archiveBytes > MAX_ARCHIVE_BYTES) {
          throw new Error(`OpenClaw ${resolved.version} archive exceeds the download limit`);
        }
        hash.update(chunk);
        yield chunk;
      }
    },
    createGunzip(),
    async (source: AsyncIterable<Uint8Array>) => {
      for await (const chunk of source) parser.push(chunk);
    },
  );
  const expected = resolved.integrity
    ? resolved.integrity.slice("sha512-".length)
    : (resolved.shasum as string);
  if (hash.digest(resolved.integrity ? "base64" : "hex") !== expected) {
    throw new Error("OpenClaw npm archive failed integrity verification");
  }
  return parser.finish();
}

// Only these files feed the packed-package reader in @openclaw/plugin-inspector.
function isPackedSurfaceFile(entryPath: string) {
  return (
    entryPath === "package/package.json" ||
    (entryPath.startsWith("package/dist/") && entryPath.endsWith(".d.ts"))
  );
}

function createPackedSurfaceParser() {
  const entries: SelectedEntry[] = [];
  const header = new Uint8Array(TAR_BLOCK_BYTES);
  let headerBytes = 0;
  let selectedBytes = 0;
  let paxPath: string | undefined;
  let ended = false;
  let body: {
    kind: "file" | "pax" | "skip";
    path: string;
    remaining: number;
    padding: number;
    chunks: Uint8Array[];
  } | null = null;
  let padding = 0;

  const completeBody = () => {
    if (!body) return;
    const bytes = concatBytes(body.chunks);
    if (body.kind === "file") entries.push({ path: body.path, bytes });
    if (body.kind === "pax") paxPath = parsePaxPath(bytes);
    padding = body.padding;
    body = null;
  };

  const startEntry = () => {
    if (header.every((byte) => byte === 0)) {
      ended = true;
      return;
    }
    const size = readTarSize(header);
    const typeflag = String.fromCharCode(header[156] ?? 0).replace("\0", "");
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 257, 5) === "ustar" ? readTarString(header, 345, 155) : "";
    const entryPath = paxPath ?? (prefix ? `${prefix}/${name}` : name);
    if (typeflag !== "x") paxPath = undefined;
    const entryPadding = (TAR_BLOCK_BYTES - (size % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
    let kind: "file" | "pax" | "skip" = "skip";
    if (typeflag === "x") {
      if (size > MAX_PAX_HEADER_BYTES) throw new Error("OpenClaw archive pax header is too large");
      kind = "pax";
    } else if ((typeflag === "" || typeflag === "0") && isPackedSurfaceFile(entryPath)) {
      if (!isSafeArchivePath(entryPath))
        throw new Error("OpenClaw archive contains an unsafe path");
      selectedBytes += size;
      if (selectedBytes > MAX_SELECTED_BYTES) {
        throw new Error("OpenClaw public plugin surface exceeds the extraction limit");
      }
      kind = "file";
    }
    body = { kind, path: entryPath, remaining: size, padding: entryPadding, chunks: [] };
    if (size === 0) completeBody();
  };

  return {
    push(chunk: Uint8Array) {
      let offset = 0;
      while (offset < chunk.byteLength) {
        // Trailing end-of-archive padding carries no entries.
        if (ended) return;
        if (body) {
          const take = Math.min(body.remaining, chunk.byteLength - offset);
          if (body.kind !== "skip") body.chunks.push(chunk.slice(offset, offset + take));
          body.remaining -= take;
          offset += take;
          if (body.remaining === 0) completeBody();
        } else if (padding > 0) {
          const take = Math.min(padding, chunk.byteLength - offset);
          padding -= take;
          offset += take;
        } else {
          const take = Math.min(TAR_BLOCK_BYTES - headerBytes, chunk.byteLength - offset);
          header.set(chunk.subarray(offset, offset + take), headerBytes);
          headerBytes += take;
          offset += take;
          if (headerBytes === TAR_BLOCK_BYTES) {
            headerBytes = 0;
            startEntry();
          }
        }
      }
    },
    finish() {
      if (!ended || body || padding > 0) throw new Error("OpenClaw archive is truncated");
      return entries;
    },
  };
}

function readTarString(block: Uint8Array, offset: number, length: number) {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return new TextDecoder().decode(end === -1 ? slice : slice.subarray(0, end));
}

function readTarSize(block: Uint8Array) {
  if ((block[124] ?? 0) & 0x80) throw new Error("OpenClaw archive entry is too large");
  const raw = readTarString(block, 124, 12).trim();
  const size = raw ? Number.parseInt(raw, 8) : 0;
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid tar entry size");
  return size;
}

// PAX record lengths count bytes, so find boundaries before decoding UTF-8.
function parsePaxPath(bytes: Uint8Array) {
  const decoder = new TextDecoder();
  let offset = 0;
  let found: string | undefined;
  while (offset < bytes.byteLength) {
    const space = bytes.indexOf(0x20, offset);
    const length =
      space === -1 ? Number.NaN : Number(decoder.decode(bytes.subarray(offset, space)));
    const end = offset + length;
    if (
      !Number.isSafeInteger(length) ||
      length <= space - offset + 1 ||
      end > bytes.byteLength ||
      bytes[end - 1] !== 0x0a
    ) {
      throw new Error("OpenClaw archive has a malformed pax header");
    }
    const record = decoder.decode(bytes.subarray(space + 1, end - 1));
    if (record.startsWith("path=")) found = record.slice("path=".length);
    offset = end;
  }
  return found;
}

function isSafeArchivePath(entryPath: string) {
  return entryPath
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function sanitizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function sanitizeRepository(repository: unknown) {
  if (typeof repository === "string") return sanitizeUrl(repository);
  if (!repository || typeof repository !== "object") return null;
  const url = (repository as { url?: unknown }).url;
  return { ...repository, url: typeof url === "string" ? sanitizeUrl(url) : null };
}
