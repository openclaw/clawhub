import { createIsomorphicFn } from "@tanstack/react-start";
import type {
  PackageAigAnalysis,
  PackageSkillSpectorAnalysis,
  ApiV1PackageResponse,
  ApiV1PackageVersionListResponse,
  PackageCompatibility,
  PackageFamily,
  PackageEndorAnalysis,
  PluginManifestSummary,
  PackageVerificationSummary,
  TemplateDependencyInventory,
  TemplateManifestSummary,
} from "clawhub-schema";
import { ApiRoutes } from "clawhub-schema/routes";
import { ConvexHttpClient } from "convex/browser";
import type { Infer } from "convex/values";
import { api } from "../../convex/_generated/api";
import type { PublicPackageDocLike } from "../../convex/lib/packageReadProjection";
import { getPluginBrowseSnapshotKind } from "../../convex/lib/pluginBrowseSnapshot";
import type { llmAnalysisValidator } from "../../convex/schema";
import { hasOwnProperty } from "./hasOwnProperty";
import { publicApiUrl } from "./publicApiUrl";
import {
  fetchInitialPublicPluginCatalog,
  fetchInitialPublicPluginCategory,
} from "./publicPluginBrowse";
import { getRequiredRuntimeEnv, getRuntimeEnv } from "./runtimeEnv";
import { getPublicClawHubSiteUrl } from "./site";

export type PackageListItem<
  Family extends "skill" | "code-plugin" | "bundle-plugin" | "template" =
    | "skill"
    | "code-plugin"
    | "bundle-plugin",
> = {
  name: string;
  displayName: string;
  family: Family;
  runtimeId?: string | null;
  channel: "official" | "community" | "private";
  isOfficial: boolean;
  summary?: string | null;
  icon?: string | null;
  iconAssetUrl?: string;
  ownerHandle?: string | null;
  ownerImage?: string | null;
  ownerOfficial?: boolean;
  createdAt: number;
  updatedAt: number;
  latestVersion?: string | null;
  categories?: string[];
  topics?: string[];
  featuredAt?: number;
  trending24h?: { downloads: number; installs: number; windowStart: number; windowEnd: number };
  verificationTier?: string | null;
  stats?: {
    downloads: number;
    installs: number;
    stars: number;
    versions: number;
  };
};

export type PackageDetailResponse = ApiV1PackageResponse & {
  /** Optional wire field. A present but invalid display projection must fail closed. */
  templateInventory?: unknown;
  /** Opt-in exact-release projection. Older registries return ordinary metadata. */
  templateRelease?: {
    version: string;
    contents: string | null;
    llmAnalysis: NonNullable<PackageVersionDetail["version"]>["llmAnalysis"] | null;
  };
};

export type PackageVersionDetail = {
  package: {
    name: string;
    displayName: string;
    family: "skill" | "code-plugin" | "bundle-plugin" | "template";
  } | null;
  version: {
    endorAnalysis?: PackageEndorAnalysis | null;
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
    templateManifestSummary?: TemplateManifestSummary | null;
    templateInventory?: TemplateDependencyInventory;
    verification?: PackageVerificationSummary | null;
    artifact?: NonNullable<PublicPackageDocLike["artifact"]> | null;
    /** @deprecated Compatibility hash for exact /download ZIP bytes. Use artifact.sha256. */
    sha256hash?: string | null;
    skillSpectorAnalysis?: PackageSkillSpectorAnalysis | null;
    aigAnalysis?: PackageAigAnalysis | null;
    llmAnalysis?: Infer<typeof llmAnalysisValidator> | null;
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

type PackageApiViewerMode = "request" | "anonymous";

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

const getForwardedHeaders = createIsomorphicFn()
  .server(async (viewerMode: PackageApiViewerMode): Promise<Record<string, string>> => {
    try {
      // Keep the import visible to the server bundler: deployed artifacts do not
      // include application dependencies for a Vite-ignored runtime import.
      const { getRequestHeaders } = await import("@tanstack/react-start/server");
      const requestHeaders = getRequestHeaders();
      const headers: Record<string, string> = {};
      const cookie = requestHeaders.get("cookie");
      const authorization = requestHeaders.get("authorization");
      const clientIpHeaders = [
        "x-vercel-forwarded-for",
        "cf-connecting-ip",
        "x-forwarded-for",
        "x-real-ip",
        "fly-client-ip",
      ] as const;
      if (viewerMode === "request") {
        if (cookie) headers.cookie = cookie;
        if (authorization) headers.authorization = authorization;
      }
      for (const headerName of clientIpHeaders) {
        const value = requestHeaders.get(headerName);
        if (value) headers[headerName] = value;
      }
      return headers;
    } catch {
      return {};
    }
  })
  .client(async (_viewerMode: PackageApiViewerMode): Promise<Record<string, string>> => ({}));

const fetchPackageResponse = createIsomorphicFn()
  .server(async (url: string, init: RequestInit, viewerMode: PackageApiViewerMode) => {
    const requestUrl = new URL(url);
    if (
      viewerMode === "anonymous" &&
      getRuntimeEnv("VITE_CLAWHUB_DEPLOY_ENV") === "production" &&
      getPluginBrowseSnapshotKind(requestUrl)
    ) {
      // A native fetch reaches the CDN; Nitro's internal dispatch bypasses it.
      const edgeUrl = new URL(
        `${requestUrl.pathname}${requestUrl.search}`,
        getPublicClawHubSiteUrl(),
      );
      return fetch(edgeUrl.toString(), init);
    }
    const { serverFetch } = await import("nitro/app");
    // Nitro routes locally by path, even for absolute URLs. Our API proxy adds
    // edge identity instead of following Convex redirects through Vercel protection.
    return serverFetch(url, init);
  })
  .client((url: string, init: RequestInit, _viewerMode: PackageApiViewerMode) => fetch(url, init));

async function packageFetch(
  url: URL,
  accept: string,
  signal?: AbortSignal,
  viewerMode: PackageApiViewerMode = "request",
) {
  const forwarded = await getForwardedHeaders(viewerMode);
  const isSameOrigin = typeof window !== "undefined" && url.origin === window.location.origin;
  return await fetchPackageResponse(
    url.toString(),
    {
      method: "GET",
      // Only send credentials for same-origin requests (production Vercel
      // rewrite). Cross-origin requests to the Convex site URL don't need
      // cookies, and `credentials: "include"` is rejected when the server
      // responds with `Access-Control-Allow-Origin: *`.
      credentials: viewerMode === "request" && isSameOrigin ? "include" : "omit",
      headers: {
        Accept: accept,
        ...forwarded,
      },
      signal,
    },
    viewerMode,
  );
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

async function fetchJson<T>(
  url: URL,
  signal?: AbortSignal,
  viewerMode?: PackageApiViewerMode,
): Promise<T> {
  const response = await packageFetch(url, "application/json", signal, viewerMode);
  if (!response.ok) throw await createPackageApiError(response);
  return (await response.json()) as T;
}

async function fetchFastCategorySnapshot(url: URL, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abortFromNavigation = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromNavigation, { once: true });
  // Preserve fast CDN hits without waiting seconds for a cold HTTP origin.
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Category cache request timed out", "TimeoutError"));
  }, 250);
  try {
    return await fetchJson<PluginCatalogResult>(url, controller.signal, "anonymous");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromNavigation);
  }
}

export async function fetchPackages(params: {
  q?: string;
  cursor?: string;
  family?: "skill" | "code-plugin" | "bundle-plugin";
  isOfficial?: boolean;
  featured?: boolean;
  createdAfter?: number;
  category?: string;
  topic?: string;
  officialFirst?: boolean;
  curated?: boolean;
  excludedScanStatuses?: Array<"clean" | "suspicious" | "malicious" | "pending" | "not-run">;
  sort?: PackageCatalogSort;
  limit?: number;
  signal?: AbortSignal;
  viewerMode?: PackageApiViewerMode;
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
    if (typeof params.createdAfter === "number") {
      url.searchParams.set("createdAfter", String(params.createdAfter));
    }
    if (params.category) url.searchParams.set("category", params.category);
    if (params.topic) url.searchParams.set("topic", params.topic);
    if (params.officialFirst) url.searchParams.set("officialFirst", "true");
    if (params.curated && !params.q?.trim()) url.searchParams.set("curated", "true");
    return await fetchJson<{
      results: Array<{
        score: number;
        package: PackageListItem;
      }>;
    }>(url, params.signal, params.viewerMode);
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
  if (params.curated && !params.q?.trim()) url.searchParams.set("curated", "true");
  if (params.excludedScanStatuses?.length) {
    url.searchParams.set("excludeScanStatus", params.excludedScanStatuses.join(","));
  }
  if (params.sort) url.searchParams.set("sort", params.sort);
  return await fetchJson<{ items: PackageListItem[]; nextCursor: string | null }>(
    url,
    params.signal,
    params.viewerMode,
  );
}

const TEMPLATE_PAGE_SIZE = 20;

// A newly started Convex deployment can accept reads before its ranked search
// index is ready. Repeat only this idempotent query, never a mutation or a 429.
const SEARCH_RETRY_DELAYS_MS = [100, 300, 700];

function waitForSearchRetry(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

async function readRankedTemplates<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await read();
    } catch (error) {
      const delay = SEARCH_RETRY_DELAYS_MS[attempt];
      if (!(error instanceof PackageApiError) || error.status !== 503 || delay === undefined)
        throw error;
      const retryAfterMs = (error.retryAfterSeconds ?? 0) * 1000;
      // Leave longer outages visible rather than holding navigation for a server-directed delay.
      if (retryAfterMs > 2000) throw error;
      await waitForSearchRetry(Math.max(delay, retryAfterMs), signal);
    }
  }
}

function requireTemplateSummary(item: PackageListItem<PackageFamily>): PackageListItem<"template"> {
  if (item.family !== "template") throw new Error("Unexpected family in Template catalog");
  return { ...item, family: item.family };
}

export async function fetchTemplateCatalog(params: {
  q?: string;
  category?: string;
  cursor?: string;
  signal: AbortSignal;
}): Promise<{ items: PackageListItem<"template">[]; nextCursor: string | null }> {
  params.signal.throwIfAborted();
  // These public queries use the same catalog implementations as the package HTTP
  // router, without loading the compatibility router or making another service hop.
  const client = new ConvexHttpClient(getRequiredRuntimeEnv("VITE_CONVEX_URL"), {
    fetch: async (input, init) => {
      const response = await fetch(input, { ...init, signal: params.signal, credentials: "omit" });
      if (response.status === 429 || response.status === 503)
        throw await createPackageApiError(response);
      return response;
    },
  });
  const filters = { family: "template" as const, category: params.category };
  const query = params.q?.trim();
  const legacyPrefix = "legacy-template-category:" + params.category + ":";
  const legacyCategoryPage = !query && params.category && params.cursor?.startsWith(legacyPrefix);
  if ((query || params.category) && !legacyCategoryPage) {
    try {
      const page = await readRankedTemplates(
        () =>
          client.query(api.templateCatalogPage.get, {
            q: query || undefined,
            category: params.category,
            cursor: params.cursor,
            limit: TEMPLATE_PAGE_SIZE,
          }),
        params.signal,
      );
      return { items: page.items.map(requireTemplateSummary), nextCursor: page.nextCursor };
    } catch (error) {
      // Only a positively absent capability can use the older registry. Never
      // reinterpret an invalid ranked cursor as a new first page.
      if (
        params.cursor ||
        !(error instanceof Error) ||
        !error.message.includes("Could not find public function for 'templateCatalogPage:get'")
      )
        throw error;
    }
  }
  if (query) {
    const results = await readRankedTemplates(
      () =>
        client.query(api.packages.searchPublic, {
          ...filters,
          query,
          limit: TEMPLATE_PAGE_SIZE,
        }),
      params.signal,
    );
    return {
      items: results.map((entry) => requireTemplateSummary(entry.package)),
      nextCursor: null,
    };
  }
  const page = await client.query(api.packages.listPublicPage, {
    ...filters,
    sort: params.category ? undefined : "downloads",
    paginationOpts: {
      cursor: legacyCategoryPage
        ? params.cursor!.slice(legacyPrefix.length)
        : (params.cursor ?? null),
      numItems: TEMPLATE_PAGE_SIZE,
    },
  });
  return {
    items: page.page.map(requireTemplateSummary),
    nextCursor: page.isDone ? null : (params.category ? legacyPrefix : "") + page.continueCursor,
  };
}

export async function fetchPluginCatalog(params: {
  q?: string;
  searchSource?: "clawhub-web";
  cursor?: string;
  family?: PluginFamily;
  isOfficial?: boolean;
  featured?: boolean;
  createdAfter?: number;
  category?: string;
  topic?: string;
  officialFirst?: boolean;
  curated?: boolean;
  excludedScanStatuses?: Array<"clean" | "suspicious" | "malicious" | "pending" | "not-run">;
  sort?: PackageCatalogSort;
  limit?: number;
  signal?: AbortSignal;
  viewerMode?: PackageApiViewerMode;
}): Promise<PluginCatalogResult> {
  if (params.family) {
    const response = await fetchPackages({
      q: params.q,
      cursor: params.cursor,
      family: params.family,
      isOfficial: params.isOfficial,
      featured: params.featured,
      createdAfter: params.createdAfter,
      category: params.category,
      topic: params.topic,
      officialFirst: params.officialFirst,
      curated: params.curated,
      excludedScanStatuses: params.excludedScanStatuses,
      sort: params.sort,
      limit: params.limit,
      signal: params.signal,
      viewerMode: params.viewerMode,
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
    if (params.searchSource) url.searchParams.set("searchSource", params.searchSource);
    if (typeof params.limit === "number") url.searchParams.set("limit", String(params.limit));
    if (typeof params.isOfficial === "boolean") {
      url.searchParams.set("isOfficial", String(params.isOfficial));
    }
    if (params.featured) url.searchParams.set("featured", "true");
    if (typeof params.createdAfter === "number") {
      url.searchParams.set("createdAfter", String(params.createdAfter));
    }
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
    }>(url, params.signal, params.viewerMode);
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
  if (params.curated && !params.q?.trim()) url.searchParams.set("curated", "true");
  if (params.excludedScanStatuses?.length) {
    url.searchParams.set("excludeScanStatus", params.excludedScanStatuses.join(","));
  }
  if (params.sort) url.searchParams.set("sort", params.sort);
  const snapshotKind = params.viewerMode === "anonymous" ? getPluginBrowseSnapshotKind(url) : null;
  if (snapshotKind === "category") {
    try {
      const result = await fetchFastCategorySnapshot(url, params.signal);
      return {
        items: result?.items ?? [],
        nextCursor: result?.nextCursor ?? null,
        totalCount: result?.totalCount ?? null,
      };
    } catch (error) {
      if (params.signal?.aborted || isRateLimitedPackageApiError(error)) throw error;
    }
  }
  if (snapshotKind) {
    try {
      const result =
        snapshotKind === "category"
          ? await fetchInitialPublicPluginCategory(url.searchParams.get("category")!, params.signal)
          : await fetchInitialPublicPluginCatalog(params.signal);
      return {
        items: result.items,
        nextCursor: result.nextCursor,
        totalCount: result.totalCount ?? null,
      };
    } catch (error) {
      if (params.signal?.aborted) throw error;
      // Retain the HTTP path during deployment skew or a failed public read.
    }
  }
  const result = await fetchJson<PluginCatalogResult>(url, params.signal, params.viewerMode);
  return {
    items: result?.items ?? [],
    nextCursor: result?.nextCursor ?? null,
    totalCount: result?.totalCount ?? null,
  };
}

export async function fetchPackageDetail(
  name: string,
  view?: "template-detail" | "template-inventory",
): Promise<PackageDetailResponse> {
  const url = await packageApiUrl(`${ApiRoutes.packages}/${encodeURIComponent(name)}`);
  if (view === "template-inventory") {
    url.searchParams.set("inventoryFallback", "metadata");
    if (typeof window === "undefined") {
      // SSR knows whether this request is carrying viewer credentials. Never probe a denied
      // public inventory and then retry the same release using a more privileged read.
      const headers = await getForwardedHeaders("request");
      url.searchParams.set(
        "view",
        headers.authorization || headers.cookie ? "template-detail" : view,
      );
    } else {
      // Same-origin visits let the web proxy inspect HttpOnly cookies. Direct cross-origin dev
      // reads are always anonymous (packageFetch uses credentials:omit for those).
      url.searchParams.set(
        "view",
        url.origin === window.location.origin ? "website-template" : view,
      );
    }
  } else if (view) url.searchParams.set("view", view);
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
  options?: { throwOnError?: boolean },
): Promise<PackageVersionDetail | null> {
  try {
    const url = await packageApiUrl(
      `${ApiRoutes.packages}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`,
    );
    return await fetchJson<PackageVersionDetail>(url);
  } catch (error) {
    // Exact-release audit pages distinguish a missing release from a retryable
    // registry failure. Keep other callers' existing best-effort SSR behavior.
    if (options?.throwOnError && !(error instanceof PackageApiError && error.status === 404)) {
      throw error;
    }
    return null;
  }
}

export async function fetchPackageReadme(
  name: string,
  version?: string | null,
): Promise<string | null> {
  const url = await packageApiUrl(`${ApiRoutes.packages}/${encodeURIComponent(name)}/file`);
  url.searchParams.set("path", "README.md");
  url.searchParams.set("preview", "1");
  if (version) url.searchParams.set("version", version);
  const response = await packageFetch(url, "text/plain");
  if (response.ok) return await response.text();
  if (
    response.status === 403 ||
    response.status === 404 ||
    response.status === 415 ||
    response.status === 423
  ) {
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
  url.searchParams.set("preview", "1");
  if (version) url.searchParams.set("version", version);
  const response = await packageFetch(url, "text/plain");
  if (response.ok) return await response.text();
  if (
    response.status === 403 ||
    response.status === 404 ||
    response.status === 415 ||
    response.status === 423
  ) {
    return null;
  }
  throw await createPackageApiError(response);
}
