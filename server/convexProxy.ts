import { getVercelOidcToken } from "@vercel/oidc";
import { defineEventHandler, getRequestURL, proxyRequest, type H3Event } from "h3";
import { compactVerify, type CompactVerifyGetKey, createRemoteJWKSet } from "jose";
import {
  ARCHIVE_MANIFEST_AUDIENCE,
  ARCHIVE_MANIFEST_CONTENT_TYPE,
  ARCHIVE_MANIFEST_JWS_TYPE,
  type SkillArchiveManifest,
} from "../convex/lib/archiveManifest";
import {
  ARCHIVE_REQUEST_IDENTITY_HEADER,
  CLAWHUB_VERCEL_PROJECT,
  CLAWHUB_VERCEL_TEAM,
} from "../convex/lib/clawhubVercelOidc";
import {
  buildDeterministicZipStream,
  type SkillZipMeta,
  validateFilePath,
  validateSlug,
} from "../convex/lib/skillZip";
import { convexDeploymentName, resolveConvexSiteUrl } from "../src/lib/convexDeploymentUrl";

const ARCHIVE_MANIFEST_REQUEST_HEADER = "x-clawhub-archive-manifest";
const ARCHIVE_MANIFEST_MAX_AGE_MS = 60_000;
const ARCHIVE_MANIFEST_CLOCK_SKEW_MS = 5_000;
const MAX_ARCHIVE_MANIFEST_ENTRIES = 8_192;
const MAX_ARCHIVE_ENTRY_URL_LENGTH = 4_096;
const MAX_ARCHIVE_MANIFEST_BYTES = 4 * 1024 * 1024;
const ARCHIVE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,499}\.zip$/;
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
  const isArchiveRequest = isSkillDownloadPath(new URL(target).pathname);
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
    return streamSkillArchive(
      response,
      env,
      target,
      event.req.signal,
      dependencies.verifyArchiveManifest,
    );
  }
  if (
    isSkillDownloadPath(new URL(target).pathname) &&
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

function isSkillDownloadPath(pathname: string) {
  return pathname === "/api/v1/download" || pathname === "/api/download";
}

async function streamSkillArchive(
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
  const manifest = parseSkillArchiveManifest(
    value,
    new URL(target).origin,
    expectedStorageOrigin,
    Date.now(),
  );
  if (!manifest) {
    return new Response("Invalid or expired archive manifest", { status: 502 });
  }

  let metricRecorded = false;
  const recordMetric = async () => {
    if (metricRecorded || !manifest.metricToken) return;
    metricRecorded = true;
    try {
      await fetch(new URL("/api/internal/archive-download-metric", target), {
        method: "POST",
        headers: { "content-type": "application/jose" },
        body: manifest.metricToken,
      });
    } catch {
      // Download metrics remain best-effort and never interrupt archive bytes.
    }
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
        await recordMetric();
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
    if (url.username || url.password || url.origin !== expectedStorageOrigin) return null;
    if (!url.pathname.startsWith("/api/storage/")) return null;
  }
  return manifest as SkillArchiveManifest;
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
