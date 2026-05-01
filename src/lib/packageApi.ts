import type {
  ApiV1PackageResponse,
  PackageCapabilitySummary,
  PackageCompatibility,
  PackageVerificationSummary,
} from "clawhub-schema";
import { ApiRoutes } from "clawhub-schema/routes";
import { hasOwnProperty } from "./hasOwnProperty";
import { getRequiredRuntimeEnv, getRuntimeEnv } from "./runtimeEnv";

export type PackageStorePackSummary = {
  available: boolean;
  specVersion: number;
  sha256: string | null;
  size: number | null;
  format: string | null;
  fileCount: number | null;
  manifestSha256: string | null;
  builtAt: number | null;
  buildVersion: string | null;
  hostTargets?: Array<{
    os: "darwin" | "linux" | "win32";
    arch: "arm64" | "x64";
    libc?: "glibc" | "musl";
    nodeRange?: string;
    openclawRange?: string;
    pluginApiRange?: string;
    supportState?: "supported" | "setup-required" | "unsupported";
    unsupportedReason?: string;
  }>;
  environment: {
    requiresLocalDesktop?: boolean;
    requiresBrowser?: boolean;
    requiresAudioDevice?: boolean;
    requiresNetwork?: boolean;
    requiresExternalServices?: string[];
    requiresOsPermissions?: string[];
    supportsRemoteHost?: boolean;
    knownUnsupported?: string[];
  } | null;
  runtimeBundles: unknown[];
};

export type PackageListItem = {
  name: string;
  displayName: string;
  family: "skill" | "code-plugin" | "bundle-plugin";
  runtimeId?: string | null;
  channel: "official" | "community" | "private";
  isOfficial: boolean;
  summary?: string | null;
  ownerHandle?: string | null;
  createdAt: number;
  updatedAt: number;
  latestVersion?: string | null;
  capabilityTags?: string[];
  executesCode?: boolean;
  verificationTier?: string | null;
  storepack?: PackageStorePackSummary;
};

export type PackageDetailResponse = ApiV1PackageResponse;

export type PackageVersionDetail = {
  package: {
    name: string;
    displayName: string;
    family: "skill" | "code-plugin" | "bundle-plugin";
  } | null;
  version: {
    version: string;
    createdAt: number;
    changelog: string;
    distTags?: string[];
    files: Array<{
      path: string;
      size: number;
      sha256: string;
      contentType?: string;
    }>;
    compatibility?: PackageCompatibility | null;
    capabilities?: PackageCapabilitySummary | null;
    verification?: PackageVerificationSummary | null;
    sha256hash?: string | null;
    vtAnalysis?: {
      status: string;
      verdict?: string;
      analysis?: string;
      source?: string;
      checkedAt: number;
    } | null;
    llmAnalysis?: {
      status: string;
      verdict?: string;
      confidence?: string;
      summary?: string;
      dimensions?: Array<{
        name: string;
        label: string;
        rating: string;
        detail: string;
      }>;
      guidance?: string;
      findings?: string;
      model?: string;
      checkedAt: number;
    } | null;
    staticScan?: {
      status: string;
      reasonCodes: string[];
      findings: Array<{
        code: string;
        severity: string;
        file: string;
        line: number;
        message: string;
        evidence: string;
      }>;
      summary: string;
      engineVersion: string;
      checkedAt: number;
    } | null;
    storepack?: PackageStorePackSummary;
  } | null;
};

type PluginFamily = "code-plugin" | "bundle-plugin";

type PluginCatalogResult = {
  items: PackageListItem[];
  nextCursor: string | null;
};

type PackageCatalogBrowseResponse = {
  items: PackageListItem[];
  nextCursor: string | null;
};

type PackageApiErrorOptions = {
  status: number;
  retryAfterSeconds?: number | null;
};

export class PackageApiError extends Error {
  status: number;
  retryAfterSeconds: number | null;

  constructor(message: string, options: PackageApiErrorOptions) {
    super(message);
    this.name = options.status === 429 ? "PackageApiRateLimitError" : "PackageApiError";
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export function isRateLimitedPackageApiError(
  error: unknown,
): error is PackageApiError & { status: 429 } {
  return error instanceof PackageApiError && error.status === 429;
}

function normalizeApiPath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function resolveAbsoluteBaseUrl(...candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    try {
      return new URL(value).toString();
    } catch {
      continue;
    }
  }
  return null;
}

async function packageApiUrl(path: string) {
  const normalizedPath = normalizeApiPath(path);
  if (typeof window !== "undefined") {
    // In production, Vercel rewrites /api/* to the Convex site, so relative
    // paths work. In local dev, Nitro intercepts the request before Vite's
    // proxy, so we must use the Convex site URL directly.
    const convexClientBaseUrl = resolveAbsoluteBaseUrl(
      getRuntimeEnv("VITE_CONVEX_SITE_URL"),
      getRuntimeEnv("VITE_CONVEX_URL"),
    );
    if (
      convexClientBaseUrl &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "0.0.0.0")
    ) {
      return new URL(normalizedPath, convexClientBaseUrl);
    }
    return new URL(normalizedPath, window.location.origin);
  }
  // On the server (SSR / loader), always use the Convex site URL directly.
  // In production, Vercel rewrites /api/* but SSR loaders run server-side
  // where the rewrite doesn't apply. Using getRequestUrl() would loop back
  // into TanStack Start / Nitro, which rejects non-HTML requests.
  const base =
    resolveAbsoluteBaseUrl(
      getRuntimeEnv("VITE_CONVEX_SITE_URL"),
      getRuntimeEnv("VITE_CONVEX_URL"),
    ) ?? getRequiredRuntimeEnv("VITE_CONVEX_URL");
  return new URL(normalizedPath, base);
}

export function getPackageDownloadPath(name: string, version?: string | null) {
  const path = normalizeApiPath(`${ApiRoutes.packages}/${encodeURIComponent(name)}/download`);
  if (!version) return path;
  return `${path}?version=${encodeURIComponent(version)}`;
}

async function getForwardedHeaders() {
  if (typeof window !== "undefined" || !import.meta.env.SSR) return {};
  try {
    const serverRuntimeModule = "@tanstack/react-start/server";
    const { getRequestHeaders } = (await import(/* @vite-ignore */ serverRuntimeModule)) as {
      getRequestHeaders: () => Headers;
    };
    const requestHeaders = getRequestHeaders();
    const headers: Record<string, string> = {};
    const cookie = requestHeaders.get("cookie");
    const authorization = requestHeaders.get("authorization");
    const clientIpHeaders = [
      "cf-connecting-ip",
      "x-forwarded-for",
      "x-real-ip",
      "fly-client-ip",
    ] as const;
    if (cookie) headers.cookie = cookie;
    if (authorization) headers.authorization = authorization;
    for (const headerName of clientIpHeaders) {
      const value = requestHeaders.get(headerName);
      if (value) headers[headerName] = value;
    }
    return headers;
  } catch {
    return {};
  }
}

async function packageFetch(url: URL, accept: string) {
  const forwarded = await getForwardedHeaders();
  const isSameOrigin = typeof window !== "undefined" && url.origin === window.location.origin;
  return await fetch(url.toString(), {
    method: "GET",
    // Only send credentials for same-origin requests (production Vercel
    // rewrite). Cross-origin requests to the Convex site URL don't need
    // cookies, and `credentials: "include"` is rejected when the server
    // responds with `Access-Control-Allow-Origin: *`.
    credentials: isSameOrigin ? "include" : "omit",
    headers: {
      Accept: accept,
      ...forwarded,
    },
  });
}

function parseRetryAfterSeconds(value: string | null): number | null {
  if (!value) return null;
  const asSeconds = Number(value);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.ceil(asSeconds);
  }
  const parsedDateMs = Date.parse(value);
  if (Number.isNaN(parsedDateMs)) return null;
  return Math.max(0, Math.ceil((parsedDateMs - Date.now()) / 1000));
}

async function createPackageApiError(response: Response) {
  const body = (await response.text()).trim();
  return new PackageApiError(body || `Request failed with status ${response.status}`, {
    status: response.status,
    retryAfterSeconds: parseRetryAfterSeconds(response.headers.get("Retry-After")),
  });
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await packageFetch(url, "application/json");
  if (!response.ok) throw await createPackageApiError(response);
  return (await response.json()) as T;
}

export async function fetchPackages(params: {
  q?: string;
  cursor?: string;
  family?: "skill" | "code-plugin" | "bundle-plugin";
  isOfficial?: boolean;
  featured?: boolean;
  executesCode?: boolean;
  capabilityTag?: string;
  limit?: number;
}) {
  if (params.q?.trim()) {
    const url = await packageApiUrl(`${ApiRoutes.packages}/search`);
    url.searchParams.set("q", params.q.trim());
    if (typeof params.limit === "number") url.searchParams.set("limit", String(params.limit));
    if (params.family) url.searchParams.set("family", params.family);
    if (typeof params.isOfficial === "boolean") {
      url.searchParams.set("isOfficial", String(params.isOfficial));
    }
    if (params.featured) url.searchParams.set("featured", "true");
    if (typeof params.executesCode === "boolean") {
      url.searchParams.set("executesCode", String(params.executesCode));
    }
    if (params.capabilityTag) url.searchParams.set("capabilityTag", params.capabilityTag);
    return await fetchJson<{ results: Array<{ score: number; package: PackageListItem }> }>(url);
  }

  const route =
    params.family === "code-plugin"
      ? ApiRoutes.codePlugins
      : params.family === "bundle-plugin"
        ? ApiRoutes.bundlePlugins
        : ApiRoutes.packages;
  const url = await packageApiUrl(route);
  if (params.cursor) url.searchParams.set("cursor", params.cursor);
  if (typeof params.limit === "number") url.searchParams.set("limit", String(params.limit));
  if (params.family === "skill") url.searchParams.set("family", "skill");
  if (typeof params.isOfficial === "boolean") {
    url.searchParams.set("isOfficial", String(params.isOfficial));
  }
  if (params.featured) url.searchParams.set("featured", "true");
  if (typeof params.executesCode === "boolean") {
    url.searchParams.set("executesCode", String(params.executesCode));
  }
  if (params.capabilityTag) url.searchParams.set("capabilityTag", params.capabilityTag);
  return await fetchJson<{ items: PackageListItem[]; nextCursor: string | null }>(url);
}

export async function fetchPluginCatalog(params: {
  q?: string;
  cursor?: string;
  family?: PluginFamily;
  isOfficial?: boolean;
  featured?: boolean;
  executesCode?: boolean;
  limit?: number;
}): Promise<PluginCatalogResult> {
  if (params.family) {
    const response = await fetchPackages({
      q: params.q,
      cursor: params.cursor,
      family: params.family,
      isOfficial: params.isOfficial,
      featured: params.featured,
      executesCode: params.executesCode,
      limit: params.limit,
    });
    if (hasOwnProperty(response, "results") && Array.isArray(response.results)) {
      return {
        items: response.results.map((entry) => entry?.package).filter(Boolean) as PackageListItem[],
        nextCursor: null,
      };
    }

    const browseResponse = response as PackageCatalogBrowseResponse;
    return {
      items: browseResponse?.items ?? [],
      nextCursor: browseResponse?.nextCursor ?? null,
    };
  }

  if (params.q?.trim()) {
    const url = await packageApiUrl(`${ApiRoutes.plugins}/search`);
    url.searchParams.set("q", params.q.trim());
    if (typeof params.limit === "number") url.searchParams.set("limit", String(params.limit));
    if (typeof params.isOfficial === "boolean") {
      url.searchParams.set("isOfficial", String(params.isOfficial));
    }
    if (params.featured) url.searchParams.set("featured", "true");
    if (typeof params.executesCode === "boolean") {
      url.searchParams.set("executesCode", String(params.executesCode));
    }
    const response = await fetchJson<{
      results?: Array<{ score: number; package: PackageListItem }>;
    }>(url);
    return {
      items: (response?.results ?? [])
        .map((entry) => entry?.package)
        .filter(Boolean) as PackageListItem[],
      nextCursor: null,
    };
  }

  const url = await packageApiUrl(ApiRoutes.plugins);
  if (params.cursor) url.searchParams.set("cursor", params.cursor);
  if (typeof params.limit === "number") url.searchParams.set("limit", String(params.limit));
  if (typeof params.isOfficial === "boolean") {
    url.searchParams.set("isOfficial", String(params.isOfficial));
  }
  if (params.featured) url.searchParams.set("featured", "true");
  if (typeof params.executesCode === "boolean") {
    url.searchParams.set("executesCode", String(params.executesCode));
  }
  const result = await fetchJson<PluginCatalogResult>(url);
  return {
    items: result?.items ?? [],
    nextCursor: result?.nextCursor ?? null,
  };
}

export async function fetchPackageDetail(name: string): Promise<PackageDetailResponse> {
  const url = await packageApiUrl(`${ApiRoutes.packages}/${encodeURIComponent(name)}`);
  const response = await packageFetch(url, "application/json");
  if (response.status === 404) {
    return { package: null, owner: null };
  }
  if (!response.ok) throw await createPackageApiError(response);
  return (await response.json()) as PackageDetailResponse;
}

export async function fetchPackageVersion(
  name: string,
  version: string,
): Promise<PackageVersionDetail | null> {
  try {
    const url = await packageApiUrl(
      `${ApiRoutes.packages}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`,
    );
    return await fetchJson<PackageVersionDetail>(url);
  } catch {
    // Return null on API error to prevent SSR crashes
    return null;
  }
}

export async function fetchPackageReadme(
  name: string,
  version?: string | null,
): Promise<string | null> {
  const url = await packageApiUrl(`${ApiRoutes.packages}/${encodeURIComponent(name)}/file`);
  url.searchParams.set("path", "README.md");
  if (version) url.searchParams.set("version", version);
  const response = await packageFetch(url, "text/plain");
  if (response.ok) return await response.text();
  if (response.status === 403 || response.status === 404 || response.status === 423) {
    return null;
  }
  throw await createPackageApiError(response);
}
