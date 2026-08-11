import { defineEventHandler, getRequestURL, proxyRequest, type H3Event } from "h3";
import {
  buildDeterministicZipStream,
  type SkillZipMeta,
  validateFilePath,
  validateSlug,
} from "../convex/lib/skillZip";
import { convexDeploymentName, resolveConvexSiteUrl } from "../src/lib/convexDeploymentUrl";

const ARCHIVE_MANIFEST_CONTENT_TYPE = "application/vnd.clawhub.skill-archive-manifest+json";
const ARCHIVE_MANIFEST_REQUEST_HEADER = "x-clawhub-archive-manifest";
const ARCHIVE_MANIFEST_MAX_AGE_MS = 60_000;
const ARCHIVE_MANIFEST_CLOCK_SKEW_MS = 5_000;
const MAX_ARCHIVE_MANIFEST_ENTRIES = 8_192;
const MAX_ARCHIVE_ENTRY_URL_LENGTH = 4_096;
const MAX_ARCHIVE_MANIFEST_BYTES = 4 * 1024 * 1024;
const ARCHIVE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,499}\.zip$/;

type SkillArchiveManifest = {
  schema: "clawhub.skill-archive-manifest.v1";
  issuedAt: number;
  expiresAt: number;
  filename: string;
  meta: SkillZipMeta;
  entries: Array<{ path: string; url: string }>;
};

type ProxyEnv = {
  CONVEX_URL?: string;
  VERCEL_ENV?: string;
  VERCEL_TARGET_ENV?: string;
  VITE_CLAWHUB_DEPLOY_ENV?: string;
  VITE_CONVEX_SITE_URL?: string;
  VITE_CONVEX_URL?: string;
};

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
  const proxied = await proxyRequest(event, target, {
    ...(isSkillDownloadPath(new URL(target).pathname)
      ? { fetchOptions: { headers: { [ARCHIVE_MANIFEST_REQUEST_HEADER]: "v1" } } }
      : {}),
  });
  // H3's HTTPResponse is not guaranteed to share Nitro's bundled class identity.
  // Normalize it before crossing that boundary or Nitro can stringify the wrapper.
  const response = new Response(proxied.body, {
    status: proxied.status,
    statusText: proxied.statusText,
    headers: proxied.headers,
  });
  if (
    response.headers.get("content-type")?.split(";", 1)[0]?.trim() === ARCHIVE_MANIFEST_CONTENT_TYPE
  ) {
    return streamSkillArchive(response, env, target, event.req.signal);
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
) {
  const manifest = parseSkillArchiveManifest(
    await readBoundedArchiveManifest(manifestResponse),
    env,
    Date.now(),
  );
  if (!manifest) {
    return new Response("Invalid or expired archive manifest", { status: 502 });
  }

  const stream = buildDeterministicZipStream(
    manifest.entries.map((entry) => ({
      path: entry.path,
      openStream: async () => {
        const response = await fetch(entry.url, { redirect: "error", signal });
        if (response.status === 404) return null;
        if (!response.ok || !response.body) {
          throw new Error(`Failed to fetch archive entry: ${response.status}`);
        }
        return response.body;
      },
    })),
    manifest.meta,
  );
  const headers = new Headers(manifestResponse.headers);
  headers.delete("content-length");
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

async function readBoundedArchiveManifest(response: Response): Promise<unknown> {
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
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

function parseSkillArchiveManifest(
  value: unknown,
  env: ProxyEnv,
  now: number,
): SkillArchiveManifest | null {
  if (!value || typeof value !== "object") return null;
  const manifest = value as Partial<SkillArchiveManifest>;
  if (manifest.schema !== "clawhub.skill-archive-manifest.v1") return null;
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

  const allowedOrigins = getConvexStorageOrigins(env);
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
    if (url.username || url.password || !allowedOrigins.has(url.origin)) return null;
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

function getConvexStorageOrigins(env: ProxyEnv) {
  const origins = new Set<string>();
  for (const candidate of [
    env.VITE_CONVEX_URL,
    env.CONVEX_URL,
    env.VITE_CONVEX_SITE_URL,
    resolveConvexSiteUrl(env),
  ]) {
    if (!candidate) continue;
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      // Invalid environment candidates are ignored; resolveConvexSiteUrl owns the hard failure.
    }
  }
  return origins;
}

export default defineEventHandler((event) => proxyConvexRequest(event));
