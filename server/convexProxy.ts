import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { getVercelOidcToken } from "@vercel/oidc";
import { defineEventHandler, getRequestURL, proxyRequest, type H3Event } from "h3";
import { compactVerify, type CompactVerifyGetKey, createRemoteJWKSet } from "jose";
import {
  ARCHIVE_MANIFEST_AUDIENCE,
  ARCHIVE_MANIFEST_CONTENT_TYPE,
  ARCHIVE_MANIFEST_JWS_TYPE,
  type SkillArchiveManifest,
  type SkillExportArchiveManifest,
  type SkillExportArchiveManifestEntry,
} from "../convex/lib/archiveManifest";
import {
  ARCHIVE_REQUEST_IDENTITY_HEADER,
  CLAWHUB_VERCEL_PROJECT,
  CLAWHUB_VERCEL_TEAM,
} from "../convex/lib/clawhubVercelOidc";
import {
  buildDeterministicZipStream,
  buildMergedExportZipStream,
  type SkillZipMeta,
  validateExportArchivePath,
  validateFilePath,
  validateSlug,
} from "../convex/lib/skillZip";
import { convexDeploymentName, resolveConvexSiteUrl } from "../src/lib/convexDeploymentUrl";

const ARCHIVE_MANIFEST_REQUEST_HEADER = "x-clawhub-archive-manifest";
const ARCHIVE_MANIFEST_MAX_AGE_MS = 60_000;
const ARCHIVE_MANIFEST_CLOCK_SKEW_MS = 5_000;
const MAX_ARCHIVE_MANIFEST_ENTRIES = 8_192;
const MAX_SKILL_EXPORT_ARCHIVE_ENTRIES = 10_501;
const MAX_SKILL_EXPORT_MANIFEST_ENTRIES = 250;
const MAX_SKILL_EXPORT_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_URL_LENGTH = 4_096;
// Mirrors the Convex signer bound for the 10,000-file bulk export contract.
const MAX_ARCHIVE_MANIFEST_BYTES = 16 * 1024 * 1024;
const SKILL_EXPORT_STORAGE_PREFETCH = 8;
const ARCHIVE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,499}\.zip$/;
const ARCHIVE_METRIC_FETCH_TIMEOUT_MS = 1_500;
const ARCHIVE_REPRESENTATION_HEADERS = [
  "accept-ranges",
  "content-digest",
  "content-encoding",
  "content-length",
  "content-md5",
  "content-range",
  "digest",
  "etag",
  "last-modified",
] as const;

type ProxyEnv = {
  CONVEX_URL?: string;
  VERCEL_ENV?: string;
  VERCEL_TARGET_ENV?: string;
  VITE_CLAWHUB_DEPLOY_ENV?: string;
  VITE_CONVEX_SITE_URL?: string;
  VITE_CONVEX_URL?: string;
};

type ProxyDependencies = {
  getArchiveRequestToken: () => Promise<string>;
  verifyArchiveManifest: (token: string, target: string) => Promise<unknown>;
};

const DEFAULT_PROXY_DEPENDENCIES: ProxyDependencies = {
  getArchiveRequestToken: () =>
    getVercelOidcToken({ team: CLAWHUB_VERCEL_TEAM, project: CLAWHUB_VERCEL_PROJECT }),
  verifyArchiveManifest: verifySignedArchiveManifest,
};
const archiveJwksByOrigin = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const BUNDLED_PROXY_ENV: ProxyEnv = {
  VITE_CLAWHUB_DEPLOY_ENV: import.meta.env.VITE_CLAWHUB_DEPLOY_ENV,
  VITE_CONVEX_SITE_URL: import.meta.env.VITE_CONVEX_SITE_URL,
  VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL,
};

export function resolveConvexProxyEnv(
  runtimeEnv: ProxyEnv,
  bundledEnv: ProxyEnv = BUNDLED_PROXY_ENV,
): ProxyEnv {
  return {
    ...runtimeEnv,
    ...(bundledEnv.VITE_CLAWHUB_DEPLOY_ENV
      ? { VITE_CLAWHUB_DEPLOY_ENV: bundledEnv.VITE_CLAWHUB_DEPLOY_ENV }
      : {}),
    ...(bundledEnv.VITE_CONVEX_SITE_URL
      ? { VITE_CONVEX_SITE_URL: bundledEnv.VITE_CONVEX_SITE_URL }
      : {}),
    ...(bundledEnv.VITE_CONVEX_URL ? { VITE_CONVEX_URL: bundledEnv.VITE_CONVEX_URL } : {}),
  };
}

function isPreviewFrontend(env: ProxyEnv) {
  const targetEnvironment =
    env.VITE_CLAWHUB_DEPLOY_ENV?.trim() || env.VERCEL_TARGET_ENV?.trim() || env.VERCEL_ENV?.trim();
  return targetEnvironment === "preview";
}

function isTestFrontend(env: ProxyEnv) {
  const targetEnvironment =
    env.VITE_CLAWHUB_DEPLOY_ENV?.trim() || env.VERCEL_TARGET_ENV?.trim() || env.VERCEL_ENV?.trim();
  return targetEnvironment === "test";
}

export function isConvexProxyMethodAllowed(method: string, env: ProxyEnv) {
  if (!isPreviewFrontend(env)) return true;
  return method === "GET" || method === "HEAD";
}

export function buildConvexProxyTarget(pathAndQuery: string, env: ProxyEnv) {
  const requestUrl = new URL(pathAndQuery, "https://clawhub.invalid");
  const targetPath = requestUrl.pathname.startsWith("/v1/feeds/")
    ? `/api${requestUrl.pathname}`
    : requestUrl.pathname;
  const targetUrl = new URL(targetPath, resolveConvexSiteUrl(env));
  targetUrl.search = requestUrl.search;
  return targetUrl.toString();
}

export async function proxyConvexRequest(
  event: H3Event,
  env: ProxyEnv = resolveConvexProxyEnv(process.env),
  dependencies: ProxyDependencies = DEFAULT_PROXY_DEPENDENCIES,
): Promise<Response> {
  if (!isConvexProxyMethodAllowed(event.req.method, env)) {
    return new Response("Disposable previews are read-only.", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  const requestUrl = getRequestURL(event);
  const target = buildConvexProxyTarget(`${requestUrl.pathname}${requestUrl.search}`, env);
  const isArchiveRequest = isArchivePath(new URL(target).pathname);
  let archiveRequestToken: string | undefined;
  if (isArchiveRequest) {
    try {
      archiveRequestToken = await dependencies.getArchiveRequestToken();
    } catch {
      return new Response("Archive streaming identity unavailable", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
  }
  const proxied = await proxyRequest(event, target, {
    ...(isArchiveRequest
      ? {
          fetchOptions: {
            headers: {
              [ARCHIVE_MANIFEST_REQUEST_HEADER]: "v1",
              [ARCHIVE_REQUEST_IDENTITY_HEADER]: archiveRequestToken!,
            },
          },
        }
      : {}),
  });
  // H3's HTTPResponse is not guaranteed to share Nitro's bundled class identity.
  // Normalize it before crossing that boundary or Nitro can stringify the wrapper.
  const response = new Response(proxied.body, {
    status: proxied.status,
    statusText: proxied.statusText,
    headers: proxied.headers,
  });
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType === ARCHIVE_MANIFEST_CONTENT_TYPE) {
    return streamArchive(
      response,
      env,
      target,
      event.req.signal,
      dependencies.verifyArchiveManifest,
    );
  }
  if (
    isArchivePath(new URL(target).pathname) &&
    contentType?.startsWith("application/vnd.clawhub.skill-archive-manifest")
  ) {
    return new Response("Invalid or expired archive manifest", { status: 502 });
  }
  if (isPreviewFrontend(env) || isTestFrontend(env)) {
    const deployment = convexDeploymentName(target);
    if (deployment) {
      response.headers.set(
        isTestFrontend(env) ? "X-ClawHub-Test-Backend" : "X-ClawHub-Preview-Backend",
        deployment,
      );
    }
  }
  return response;
}

function isArchivePath(pathname: string) {
  return (
    pathname === "/api/v1/download" ||
    pathname === "/api/download" ||
    pathname === "/api/v1/skills/export"
  );
}

async function streamArchive(
  manifestResponse: Response,
  env: ProxyEnv,
  target: string,
  signal: AbortSignal,
  verifyArchiveManifest: ProxyDependencies["verifyArchiveManifest"],
) {
  let value: unknown;
  try {
    const token = await readBoundedArchiveManifest(manifestResponse);
    if (!token) return new Response("Invalid or expired archive manifest", { status: 502 });
    value = await verifyArchiveManifest(token, target);
  } catch {
    return new Response("Invalid or expired archive manifest", { status: 502 });
  }
  const expectedStorageOrigin = resolveConvexStorageOrigin(target, env);
  const expectedIssuer = new URL(target).origin;
  const now = Date.now();
  const skillManifest = parseSkillArchiveManifest(
    value,
    expectedIssuer,
    expectedStorageOrigin,
    now,
  );
  const exportManifest = parseSkillExportArchiveManifest(
    value,
    expectedIssuer,
    expectedStorageOrigin,
    now,
  );
  if (!skillManifest && !exportManifest) {
    return new Response("Invalid or expired archive manifest", { status: 502 });
  }

  if (exportManifest) {
    return streamSkillExportArchive(exportManifest, manifestResponse, env, target, signal);
  }

  const manifest = skillManifest!;

  let metricRecorded = false;
  const recordMetric = () => {
    if (metricRecorded || !manifest.metricToken) return;
    metricRecorded = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ARCHIVE_METRIC_FETCH_TIMEOUT_MS);
    void fetch(new URL("/api/internal/archive-download-metric", target), {
      method: "POST",
      headers: { "content-type": "application/jose" },
      body: manifest.metricToken,
      signal: controller.signal,
    })
      .catch(() => {
        // Download metrics remain best-effort and never interrupt archive bytes.
      })
      .finally(() => {
        clearTimeout(timeout);
      });
  };

  const stream = buildDeterministicZipStream(
    manifest.entries.map((entry) => ({
      path: entry.path,
      openStream: async () => {
        const response = await fetch(entry.url, { redirect: "error", signal });
        if (response.status === 404) return null;
        if (!response.ok || !response.body) {
          throw new Error(`Failed to fetch archive entry: ${response.status}`);
        }
        recordMetric();
        return response.body;
      },
    })),
    manifest.meta,
  );
  const headers = new Headers(manifestResponse.headers);
  for (const name of ARCHIVE_REPRESENTATION_HEADERS) headers.delete(name);
  headers.set("content-type", "application/zip");
  headers.set("content-disposition", `attachment; filename="${manifest.filename}"`);
  const response = new Response(stream, { status: 200, headers });
  if (isPreviewFrontend(env) || isTestFrontend(env)) {
    const deployment = convexDeploymentName(target);
    if (deployment) {
      response.headers.set(
        isTestFrontend(env) ? "X-ClawHub-Test-Backend" : "X-ClawHub-Preview-Backend",
        deployment,
      );
    }
  }
  return response;
}

function streamSkillExportArchive(
  manifest: SkillExportArchiveManifest,
  manifestResponse: Response,
  env: ProxyEnv,
  target: string,
  signal: AbortSignal,
) {
  const prefetched = prefetchSkillExportEntries(manifest.entries, signal);
  const archiveStream = buildMergedExportZipStream(prefetched.entries, manifest.exportManifest);
  const stream = cancelPrefetchWithArchive(archiveStream, prefetched.cancel);
  const headers = archiveResponseHeaders(manifestResponse, manifest.filename);
  const response = new Response(stream, { status: 200, headers });
  addDeploymentProofHeader(response, env, target);
  return response;
}

function prefetchSkillExportEntries(
  entries: SkillExportArchiveManifestEntry[],
  signal: AbortSignal,
) {
  const controller = new AbortController();
  const abortFromRequest = () => controller.abort(signal.reason);
  if (signal.aborted) abortFromRequest();
  else signal.addEventListener("abort", abortFromRequest, { once: true });
  const ordered = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const storageEntries = ordered.filter(
    (entry): entry is Extract<SkillExportArchiveManifestEntry, { kind: "storage" }> =>
      entry.kind === "storage",
  );
  type PrefetchResult =
    | { ok: true; stream: ReadableStream<Uint8Array> }
    | { ok: false; error: unknown };
  const pending = new Map<
    Extract<SkillExportArchiveManifestEntry, { kind: "storage" }>,
    Promise<PrefetchResult>
  >();
  let nextStorageIndex = 0;
  let cancelled = false;

  const fetchEntry = async (
    entry: Extract<SkillExportArchiveManifestEntry, { kind: "storage" }>,
  ): Promise<PrefetchResult> => {
    try {
      const response = await fetch(entry.url, { redirect: "error", signal: controller.signal });
      if (response.status === 404) {
        throw new Error("Signed archive entry disappeared after manifest creation");
      }
      if (!response.ok || !response.body) {
        throw new Error(`Failed to fetch archive entry: ${response.status}`);
      }
      return {
        ok: true,
        stream: enforceStreamIntegrity(response.body, entry.size, entry.sha256),
      };
    } catch (error) {
      return { ok: false, error };
    }
  };
  const fillPrefetchWindow = () => {
    while (
      !cancelled &&
      pending.size < SKILL_EXPORT_STORAGE_PREFETCH &&
      nextStorageIndex < storageEntries.length
    ) {
      const entry = storageEntries[nextStorageIndex++];
      pending.set(entry, fetchEntry(entry));
    }
  };
  fillPrefetchWindow();

  return {
    entries: ordered.map((entry) => ({
      path: entry.path,
      openStream: async () => {
        if (entry.kind === "inline") {
          const bytes = new TextEncoder().encode(entry.text);
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          });
        }
        const result = await (pending.get(entry) ?? fetchEntry(entry));
        pending.delete(entry);
        fillPrefetchWindow();
        if (!result.ok) throw result.error;
        return result.stream;
      },
    })),
    cancel: async (reason?: unknown) => {
      if (cancelled) return;
      cancelled = true;
      controller.abort(reason);
      const results = await Promise.allSettled(pending.values());
      pending.clear();
      await Promise.allSettled(
        results.flatMap((result) =>
          result.status === "fulfilled" && result.value.ok
            ? [result.value.stream.cancel(reason)]
            : [],
        ),
      );
    },
  };
}

function cancelPrefetchWithArchive(
  stream: ReadableStream<Uint8Array>,
  cancelPrefetch: (reason?: unknown) => Promise<void>,
) {
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            reader.releaseLock();
            controller.close();
          } else {
            controller.enqueue(chunk.value);
          }
        } catch (error) {
          await cancelPrefetch(error);
          controller.error(error);
        }
      },
      async cancel(reason) {
        await Promise.allSettled([reader.cancel(reason), cancelPrefetch(reason)]);
      },
    },
    { highWaterMark: 0 },
  );
}

function enforceStreamIntegrity(
  stream: ReadableStream<Uint8Array>,
  expectedBytes: number,
  expectedSha256: string,
) {
  const reader = stream.getReader();
  const hash = createHash("sha256");
  let receivedBytes = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        const digestMatches = hash.digest("hex") === expectedSha256.toLowerCase();
        if (receivedBytes !== expectedBytes || !digestMatches) {
          controller.error(new Error("Archive entry did not match its signed manifest"));
        } else {
          controller.close();
        }
        reader.releaseLock();
        return;
      }
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > expectedBytes) {
        await reader.cancel("Archive entry exceeded its signed size").catch(() => undefined);
        controller.error(new Error("Archive entry exceeded its signed size"));
        return;
      }
      hash.update(chunk.value);
      controller.enqueue(chunk.value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

function archiveResponseHeaders(manifestResponse: Response, filename: string) {
  const headers = new Headers(manifestResponse.headers);
  for (const name of ARCHIVE_REPRESENTATION_HEADERS) headers.delete(name);
  headers.set("content-type", "application/zip");
  headers.set("content-disposition", `attachment; filename="${filename}"`);
  return headers;
}

function addDeploymentProofHeader(response: Response, env: ProxyEnv, target: string) {
  if (!isPreviewFrontend(env) && !isTestFrontend(env)) return;
  const deployment = convexDeploymentName(target);
  if (!deployment) return;
  response.headers.set(
    isTestFrontend(env) ? "X-ClawHub-Test-Backend" : "X-ClawHub-Preview-Backend",
    deployment,
  );
}

async function readBoundedArchiveManifest(response: Response) {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_ARCHIVE_MANIFEST_BYTES) return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_ARCHIVE_MANIFEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseSkillArchiveManifest(
  value: unknown,
  expectedIssuer: string,
  expectedStorageOrigin: string | null,
  now: number,
): SkillArchiveManifest | null {
  if (!value || typeof value !== "object") return null;
  const manifest = value as Partial<SkillArchiveManifest>;
  if (manifest.schema !== "clawhub.skill-archive-manifest.v1") return null;
  if (
    manifest.issuer !== expectedIssuer ||
    manifest.audience !== ARCHIVE_MANIFEST_AUDIENCE ||
    !expectedStorageOrigin
  ) {
    return null;
  }
  if (!Number.isFinite(manifest.issuedAt) || !Number.isFinite(manifest.expiresAt)) return null;
  const issuedAt = manifest.issuedAt as number;
  const expiresAt = manifest.expiresAt as number;
  if (issuedAt > now + ARCHIVE_MANIFEST_CLOCK_SKEW_MS || expiresAt <= now) return null;
  if (expiresAt <= issuedAt || expiresAt - issuedAt > ARCHIVE_MANIFEST_MAX_AGE_MS) return null;
  if (typeof manifest.filename !== "string" || !ARCHIVE_FILENAME_PATTERN.test(manifest.filename)) {
    return null;
  }
  if (!isSkillZipMeta(manifest.meta)) return null;
  if (!Array.isArray(manifest.entries) || manifest.entries.length > MAX_ARCHIVE_MANIFEST_ENTRIES) {
    return null;
  }
  if (
    manifest.metricToken !== undefined &&
    (typeof manifest.metricToken !== "string" || manifest.metricToken.length > 16 * 1024)
  ) {
    return null;
  }

  const seenPaths = new Set<string>();
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== "object") return null;
    if (typeof entry.path !== "string" || !validateFilePath(entry.path)) return null;
    if (seenPaths.has(entry.path)) return null;
    seenPaths.add(entry.path);
    if (typeof entry.url !== "string" || entry.url.length > MAX_ARCHIVE_ENTRY_URL_LENGTH) {
      return null;
    }
    let url: URL;
    try {
      url = new URL(entry.url);
    } catch {
      return null;
    }
    if (!isCanonicalConvexStorageUrl(url, expectedStorageOrigin)) return null;
  }
  return manifest as SkillArchiveManifest;
}

function parseSkillExportArchiveManifest(
  value: unknown,
  expectedIssuer: string,
  expectedStorageOrigin: string | null,
  now: number,
): SkillExportArchiveManifest | null {
  if (!value || typeof value !== "object") return null;
  const manifest = value as Partial<SkillExportArchiveManifest>;
  if (manifest.schema !== "clawhub.skill-export-archive-manifest.v1") return null;
  if (
    manifest.issuer !== expectedIssuer ||
    manifest.audience !== ARCHIVE_MANIFEST_AUDIENCE ||
    !expectedStorageOrigin ||
    !isFreshArchiveManifest(manifest, now) ||
    typeof manifest.filename !== "string" ||
    !ARCHIVE_FILENAME_PATTERN.test(manifest.filename) ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length > MAX_SKILL_EXPORT_ARCHIVE_ENTRIES ||
    !Array.isArray(manifest.exportManifest) ||
    manifest.exportManifest.length > MAX_SKILL_EXPORT_MANIFEST_ENTRIES
  ) {
    return null;
  }

  const seenPaths = new Set<string>();
  let totalStorageBytes = 0;
  let totalInlineBytes = Buffer.byteLength(
    JSON.stringify(manifest.exportManifest, null, 2),
    "utf8",
  );
  for (const entry of manifest.entries) {
    if (!isSkillExportArchiveEntry(entry, expectedStorageOrigin)) return null;
    if (entry.path === "_manifest.json" || seenPaths.has(entry.path)) return null;
    seenPaths.add(entry.path);
    if (entry.kind === "storage") {
      totalStorageBytes += entry.size;
      if (totalStorageBytes > MAX_SKILL_EXPORT_TOTAL_BYTES) return null;
    } else {
      // Stored payload keeps its existing 256 MiB contract. Inline entries and
      // the generated manifest share the separately bounded signed-JWS budget.
      totalInlineBytes += Buffer.byteLength(entry.text, "utf8");
      if (totalInlineBytes > MAX_ARCHIVE_MANIFEST_BYTES) return null;
    }
  }
  if (!manifest.exportManifest.every(isMergedExportManifestEntry)) return null;
  return manifest as SkillExportArchiveManifest;
}

function isFreshArchiveManifest(manifest: { issuedAt?: number; expiresAt?: number }, now: number) {
  if (!Number.isFinite(manifest.issuedAt) || !Number.isFinite(manifest.expiresAt)) return false;
  const issuedAt = manifest.issuedAt as number;
  const expiresAt = manifest.expiresAt as number;
  return (
    issuedAt <= now + ARCHIVE_MANIFEST_CLOCK_SKEW_MS &&
    expiresAt > now &&
    expiresAt > issuedAt &&
    expiresAt - issuedAt <= ARCHIVE_MANIFEST_MAX_AGE_MS
  );
}

function isSkillExportArchiveEntry(
  value: unknown,
  expectedStorageOrigin: string,
): value is SkillExportArchiveManifestEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<SkillExportArchiveManifestEntry>;
  if (typeof entry.path !== "string" || !validateExportArchivePath(entry.path)) return false;
  if (entry.kind === "inline") return typeof entry.text === "string";
  if (
    entry.kind !== "storage" ||
    typeof entry.url !== "string" ||
    entry.url.length > MAX_ARCHIVE_ENTRY_URL_LENGTH ||
    !Number.isSafeInteger(entry.size) ||
    (entry.size as number) < 0 ||
    typeof entry.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(entry.sha256)
  ) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    return false;
  }
  return isCanonicalConvexStorageUrl(url, expectedStorageOrigin);
}

function isCanonicalConvexStorageUrl(url: URL, expectedStorageOrigin: string) {
  return (
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.origin === expectedStorageOrigin &&
    /^\/api\/storage\/[A-Za-z0-9_-]+$/.test(url.pathname)
  );
}

function isMergedExportManifestEntry(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.publisher === "string" &&
    validateSlug(entry.publisher) &&
    typeof entry.slug === "string" &&
    validateSlug(entry.slug) &&
    (entry.sourceRef === "public-clawhub" || entry.sourceRef === "public-github") &&
    (entry.version === null || typeof entry.version === "string") &&
    typeof entry.displayName === "string" &&
    Number.isFinite(entry.createdAt) &&
    Number.isFinite(entry.updatedAt) &&
    (entry.stats === null ||
      (!!entry.stats && typeof entry.stats === "object" && !Array.isArray(entry.stats))) &&
    Number.isSafeInteger(entry.fileCount) &&
    (entry.fileCount as number) >= 0
  );
}

function isSkillZipMeta(value: unknown): value is SkillZipMeta {
  if (!value || typeof value !== "object") return false;
  const meta = value as Partial<SkillZipMeta>;
  return (
    typeof meta.ownerId === "string" &&
    typeof meta.slug === "string" &&
    validateSlug(meta.slug) &&
    typeof meta.version === "string" &&
    meta.version.length > 0 &&
    meta.version.length <= 200 &&
    typeof meta.publishedAt === "number" &&
    Number.isFinite(meta.publishedAt)
  );
}

export async function verifySignedArchiveManifest(
  token: string,
  target: string,
  jwksOverride?: CompactVerifyGetKey,
) {
  const targetOrigin = new URL(target).origin;
  let jwks = jwksOverride ?? archiveJwksByOrigin.get(targetOrigin);
  if (!jwks) {
    const remoteJwks = createRemoteJWKSet(new URL("/.well-known/jwks.json", targetOrigin));
    archiveJwksByOrigin.set(targetOrigin, remoteJwks);
    jwks = remoteJwks;
  }
  const verified = await compactVerify(token, jwks, { algorithms: ["RS256"] });
  if (verified.protectedHeader.typ !== ARCHIVE_MANIFEST_JWS_TYPE) {
    throw new Error("Unexpected archive manifest signature type");
  }
  return JSON.parse(new TextDecoder().decode(verified.payload)) as unknown;
}

export function resolveConvexStorageOrigin(target: string, env: ProxyEnv) {
  let targetOrigin: string;
  let selectedSiteOrigin: string;
  let cloudUrl: URL;
  try {
    targetOrigin = new URL(target).origin;
    selectedSiteOrigin = resolveConvexSiteUrl(env);
    cloudUrl = new URL(env.VITE_CONVEX_URL ?? env.CONVEX_URL ?? "");
  } catch {
    return null;
  }
  if (targetOrigin !== selectedSiteOrigin) return null;

  const isLocalCloud =
    cloudUrl.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(cloudUrl.hostname);
  if (isLocalCloud) return cloudUrl.origin;
  if (cloudUrl.protocol !== "https:" || !cloudUrl.hostname.endsWith(".convex.cloud")) {
    return null;
  }

  const targetDeployment = convexDeploymentName(target);
  const cloudDeployment = cloudUrl.hostname.slice(0, -".convex.cloud".length);
  if (targetDeployment && targetDeployment !== cloudDeployment) return null;
  return cloudUrl.origin;
}

export default defineEventHandler((event) => proxyConvexRequest(event));
