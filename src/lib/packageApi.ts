import type {
  ApiV1PackageResponse,
  ApiV1PackageVersionListResponse,
  PackageCompatibility,
  PluginManifestSummary,
  PackageVerificationSummary,
} from "clawhub-schema";
import { ApiRoutes } from "clawhub-schema/routes";
import { hasOwnProperty } from "./hasOwnProperty";
import { publicApiUrl } from "./publicApiUrl";

export type PackageListItem = {
  name: string;
  displayName: string;
  family: "skill" | "code-plugin" | "bundle-plugin";
  runtimeId?: string | null;
  channel: "official" | "community" | "private";
  isOfficial: boolean;
  summary?: string | null;
  icon?: string | null;
  ownerHandle?: string | null;
  createdAt: number;
  updatedAt: number;
  latestVersion?: string | null;
  categories?: string[];
  topics?: string[];
  verificationTier?: string | null;
  stats?: {
    downloads: number;
    installs: number;
    stars: number;
    versions: number;
  };
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
    pluginManifestSummary?: PluginManifestSummary | null;
    verification?: PackageVerificationSummary | null;
    artifact?: {
      kind: "legacy-zip" | "npm-pack";
      sha256?: string;
      size?: number;
      format?: string;
      npmIntegrity?: string;
      npmShasum?: string;
      npmTarballName?: string;
      npmUnpackedSize?: number;
      npmFileCount?: number;
    } | null;
    /** @deprecated Compatibility hash for exact /download ZIP bytes. Use artifact.sha256. */
    sha256hash?: string | null;
    vtAnalysis?: {
      status: string;
      verdict?: string;
      analysis?: string;
      source?: string;
      checkedAt: number;
    } | null;
    skillSpectorAnalysis?: {
      status: string;
      score?: number;
      severity?: string;
      recommendation?: string;
      issueCount: number;
      issues: Array<{
        issueId: string;
        category?: string;
        pattern?: string;
        severity: string;
        confidence?: number;
        file?: string;
        startLine?: number;
        endLine?: number;
        explanation: string;
        remediation?: string;
        finding?: string;
        codeSnippet?: string;
      }>;
      scannerVersion?: string;
      summary?: string;
      error?: string;
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
      agenticRiskFindings?: Array<{
        categoryId: string;
        categoryLabel: string;
        riskBucket:
          | "abnormal_behavior_control"
          | "permission_boundary"
          | "sensitive_data_protection";
        status: "none" | "note" | "concern";
        severity: string;
        confidence: "high" | "medium" | "low";
        evidence?: {
          path: string;
          snippet: string;
          explanation: string;
        };
        userImpact: string;
        recommendation: string;
      }>;
      riskSummary?: {
        abnormal_behavior_control: {
          status: "none" | "note" | "concern";
          summary: string;
          highestSeverity?: string;
        };
        permission_boundary: {
          status: "none" | "note" | "concern";
          summary: string;
          highestSeverity?: string;
        };
        sensitive_data_protection: {
          status: "none" | "note" | "concern";
          summary: string;
          highestSeverity?: string;
        };
      };
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
  } | null;
};

type PluginFamily = "code-plugin" | "bundle-plugin";
type PackageCatalogSort = "updated" | "recommended" | "downloads" | "trending";

type PluginCatalogResult = {
  items: PackageListItem[];
  nextCursor: string | null;
  totalCount?: number | null;
};

type PackageCatalogBrowseResponse = {
  items: PackageListItem[];
  nextCursor: string | null;
  totalCount?: number | null;
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

async function packageApiUrl(path: string) {
  return publicApiUrl(path);
}

export function getPackageDownloadPath(name: string, version?: string | null) {
  const path = normalizeApiPath(`${ApiRoutes.packages}/${encodeURIComponent(name)}/download`);
  if (!version) return path;
  return `${path}?version=${encodeURIComponent(version)}`;
}

export function getPackageArtifactDownloadPath(name: string, version: string) {
  return normalizeApiPath(
    `${ApiRoutes.packages}/${encodeURIComponent(name)}/versions/${encodeURIComponent(
      version,
    )}/artifact/download`,
  );
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

async function packageFetch(url: URL, accept: string, signal?: AbortSignal) {
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
    signal,
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
  return new PackageApiError(normalizePackageApiErrorBody(response.status, body), {
    status: response.status,
    retryAfterSeconds: parseRetryAfterSeconds(response.headers.get("Retry-After")),
  });
}

function normalizePackageApiErrorBody(status: number, body: string) {
  const lowered = body.toLowerCase();
  if (body && lowered !== "unauthorized" && lowered !== "forbidden") {
    if (status === 404 && lowered === "package not found") {
      return "Package not found or not visible to this account.";
    }
    if (status === 404 && lowered === "skill not found") {
      return "Skill not found or unavailable to this account.";
    }
    return body;
  }
  if (status === 401) {
    return "Sign in required. If this ClawHub account was deleted, banned, or disabled, it cannot access private packages.";
  }
  if (status === 403) {
    return "This ClawHub account does not have access to this package or action, or the account is not in good standing.";
  }
  return body || `Request failed with status ${status}`;
}

async function fetchJson<T>(url: URL, signal?: AbortSignal): Promise<T> {
  const response = await packageFetch(url, "application/json", signal);
  if (!response.ok) throw await createPackageApiError(response);
  return (await response.json()) as T;
}

export async function fetchPackages(params: {
  q?: string;
  cursor?: string;
  family?: "skill" | "code-plugin" | "bundle-plugin";
  isOfficial?: boolean;
  featured?: boolean;
  category?: string;
  topic?: string;
  officialFirst?: boolean;
  excludedScanStatuses?: Array<"clean" | "suspicious" | "malicious" | "pending" | "not-run">;
  sort?: PackageCatalogSort;
  limit?: number;
  signal?: AbortSignal;
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
    if (params.category) url.searchParams.set("category", params.category);
    if (params.topic) url.searchParams.set("topic", params.topic);
    if (params.officialFirst) url.searchParams.set("officialFirst", "true");
    return await fetchJson<{
      results: Array<{
        score: number;
        package: PackageListItem;
      }>;
    }>(url, params.signal);
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
  if (params.category) url.searchParams.set("category", params.category);
  if (params.topic) url.searchParams.set("topic", params.topic);
  if (params.officialFirst) url.searchParams.set("officialFirst", "true");
  if (params.excludedScanStatuses?.length) {
    url.searchParams.set("excludeScanStatus", params.excludedScanStatuses.join(","));
  }
  if (params.sort) url.searchParams.set("sort", params.sort);
  return await fetchJson<{ items: PackageListItem[]; nextCursor: string | null }>(
    url,
    params.signal,
  );
}

export async function fetchPluginCatalog(params: {
  q?: string;
  cursor?: string;
  family?: PluginFamily;
  isOfficial?: boolean;
  featured?: boolean;
  category?: string;
  topic?: string;
  officialFirst?: boolean;
  excludedScanStatuses?: Array<"clean" | "suspicious" | "malicious" | "pending" | "not-run">;
  sort?: PackageCatalogSort;
  limit?: number;
  signal?: AbortSignal;
}): Promise<PluginCatalogResult> {
  if (params.family) {
    const response = await fetchPackages({
      q: params.q,
      cursor: params.cursor,
      family: params.family,
      isOfficial: params.isOfficial,
      featured: params.featured,
      category: params.category,
      topic: params.topic,
      officialFirst: params.officialFirst,
      excludedScanStatuses: params.excludedScanStatuses,
      sort: params.sort,
      limit: params.limit,
      signal: params.signal,
    });
    if (hasOwnProperty(response, "results") && Array.isArray(response.results)) {
      return {
        items: response.results.map((entry) => entry?.package).filter(Boolean),
        nextCursor: null,
      };
    }

    const browseResponse = response as PackageCatalogBrowseResponse;
    return {
      items: browseResponse?.items ?? [],
      nextCursor: browseResponse?.nextCursor ?? null,
      totalCount: browseResponse?.totalCount ?? null,
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
    if (params.category) url.searchParams.set("category", params.category);
    if (params.topic) url.searchParams.set("topic", params.topic);
    if (params.excludedScanStatuses?.length) {
      url.searchParams.set("excludeScanStatus", params.excludedScanStatuses.join(","));
    }
    const response = await fetchJson<{
      results?: Array<{
        score: number;
        package: PackageListItem;
      }>;
    }>(url, params.signal);
    return {
      items: (response?.results ?? []).map((entry) => entry?.package).filter(Boolean),
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
  if (params.category) url.searchParams.set("category", params.category);
  if (params.topic) url.searchParams.set("topic", params.topic);
  if (params.officialFirst) url.searchParams.set("officialFirst", "true");
  if (params.excludedScanStatuses?.length) {
    url.searchParams.set("excludeScanStatus", params.excludedScanStatuses.join(","));
  }
  if (params.sort) url.searchParams.set("sort", params.sort);
  const result = await fetchJson<PluginCatalogResult>(url, params.signal);
  return {
    items: result?.items ?? [],
    nextCursor: result?.nextCursor ?? null,
    totalCount: result?.totalCount ?? null,
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

export async function fetchPackageVersions(
  name: string,
  options?: {
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<ApiV1PackageVersionListResponse> {
  const url = await packageApiUrl(`${ApiRoutes.packages}/${encodeURIComponent(name)}/versions`);
  if (options?.cursor) url.searchParams.set("cursor", options.cursor);
  if (typeof options?.limit === "number") url.searchParams.set("limit", String(options.limit));
  return await fetchJson<ApiV1PackageVersionListResponse>(url, options?.signal);
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

export async function fetchPackageFile(
  name: string,
  path: string,
  version?: string | null,
): Promise<string | null> {
  const url = await packageApiUrl(`${ApiRoutes.packages}/${encodeURIComponent(name)}/file`);
  url.searchParams.set("path", path);
  if (version) url.searchParams.set("version", version);
  const response = await packageFetch(url, "text/plain");
  if (response.ok) return await response.text();
  if (response.status === 403 || response.status === 404 || response.status === 423) {
    return null;
  }
  throw await createPackageApiError(response);
}
