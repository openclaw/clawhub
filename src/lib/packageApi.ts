import type {
  PackageCapabilitySummary,
  PackageCompatibility,
  PackageVerificationSummary,
} from "clawhub-schema";
import { ApiRoutes } from "clawhub-schema";
import { getRequiredRuntimeEnv, getRuntimeEnv } from "./runtimeEnv";

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
};

export type PackageDetailResponse = {
  package: {
    _id?: string;
    name: string;
    displayName: string;
    family: "skill" | "code-plugin" | "bundle-plugin";
    runtimeId?: string | null;
    channel: "official" | "community" | "private";
    isOfficial: boolean;
    summary?: string | null;
    latestVersion?: string | null;
    createdAt: number;
    updatedAt: number;
    tags: Record<string, string>;
    compatibility?: PackageCompatibility | null;
    capabilities?: PackageCapabilitySummary | null;
    verification?: PackageVerificationSummary | null;
  } | null;
  owner: {
    handle?: string | null;
    displayName?: string | null;
    image?: string | null;
  } | null;
};

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
  } | null;
};

type PluginFamily = "code-plugin" | "bundle-plugin";

type PluginCatalogSourceCursor = {
  cursor: string | null;
  offset: number;
  pageSize: number;
  done: boolean;
};

type PluginCatalogCursorState = {
  code: PluginCatalogSourceCursor;
  bundle: PluginCatalogSourceCursor;
};

type PluginCatalogResult = {
  items: PackageListItem[];
  nextCursor: string | null;
};

const DEFAULT_PLUGIN_SOURCE_CURSOR: PluginCatalogSourceCursor = {
  cursor: null,
  offset: 0,
  pageSize: 0,
  done: false,
};

function clonePluginSourceCursor(
  source: Partial<PluginCatalogSourceCursor> | null | undefined,
): PluginCatalogSourceCursor {
  return {
    cursor: typeof source?.cursor === "string" ? source.cursor : null,
    offset: typeof source?.offset === "number" && source.offset > 0 ? source.offset : 0,
    pageSize: typeof source?.pageSize === "number" && source.pageSize > 0 ? source.pageSize : 0,
    done: source?.done === true,
  };
}

function encodePluginCatalogCursor(state: PluginCatalogCursorState) {
  return `plugcat:${encodeURIComponent(JSON.stringify(state))}`;
}

function decodePluginCatalogCursor(cursor: string | undefined): PluginCatalogCursorState {
  if (!cursor?.startsWith("plugcat:")) {
    return {
      code: { ...DEFAULT_PLUGIN_SOURCE_CURSOR },
      bundle: { ...DEFAULT_PLUGIN_SOURCE_CURSOR },
    };
  }
  try {
    const decoded = JSON.parse(decodeURIComponent(cursor.slice("plugcat:".length))) as {
      code?: Partial<PluginCatalogSourceCursor>;
      bundle?: Partial<PluginCatalogSourceCursor>;
    };
    return {
      code: clonePluginSourceCursor(decoded.code),
      bundle: clonePluginSourceCursor(decoded.bundle),
    };
  } catch {
    return {
      code: { ...DEFAULT_PLUGIN_SOURCE_CURSOR },
      bundle: { ...DEFAULT_PLUGIN_SOURCE_CURSOR },
    };
  }
}

function comparePluginListItems(a: PackageListItem | undefined, b: PackageListItem | undefined) {
  if (!a) return 1;
  if (!b) return -1;
  return (
    b.updatedAt - a.updatedAt ||
    b.createdAt - a.createdAt ||
    a.name.localeCompare(b.name)
  );
}

function normalizeApiPath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

async function packageApiUrl(path: string) {
  const normalizedPath = normalizeApiPath(path);
  if (typeof window !== "undefined") {
    return new URL(normalizedPath, window.location.origin);
  }
  if (import.meta.env.SSR) {
    try {
      const serverRuntimeModule = "@tanstack/react-start/server";
      const { getRequestUrl } = (await import(
        /* @vite-ignore */ serverRuntimeModule
      )) as {
        getRequestUrl: () => URL;
      };
      return new URL(normalizedPath, getRequestUrl());
    } catch {
      // Fall through to env-based base URL when no request context exists.
    }
  }
  const base =
    getRuntimeEnv("VITE_CONVEX_SITE_URL") ?? getRequiredRuntimeEnv("VITE_CONVEX_URL");
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
    const { getRequestHeaders } = (await import(
      /* @vite-ignore */ serverRuntimeModule
    )) as {
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
  return await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: accept,
      ...forwarded,
    },
  });
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await packageFetch(url, "application/json");
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

export async function fetchPackages(params: {
  q?: string;
  cursor?: string;
  family?: "skill" | "code-plugin" | "bundle-plugin";
  isOfficial?: boolean;
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
  executesCode?: boolean;
  limit?: number;
}): Promise<PluginCatalogResult> {
  if (params.family) {
    const response = await fetchPackages({
      q: params.q,
      cursor: params.cursor,
      family: params.family,
      isOfficial: params.isOfficial,
      executesCode: params.executesCode,
      limit: params.limit,
    });
    return {
      items: "results" in response ? response.results.map((entry) => entry.package) : response.items,
      nextCursor: "results" in response ? null : response.nextCursor,
    };
  }

  const limit = Math.max(1, Math.min(params.limit ?? 25, 100));
  const families: PluginFamily[] = ["code-plugin", "bundle-plugin"];

  if (params.q?.trim()) {
    const results = await Promise.all(
      families.map(async (family) => {
        const response = await fetchPackages({
          q: params.q,
          family,
          isOfficial: params.isOfficial,
          executesCode: params.executesCode,
          limit,
        });
        return "results" in response ? response.results : [];
      }),
    );
    return {
      items: results
        .flat()
        .sort(
          (a, b) =>
            b.score - a.score ||
            Number(b.package.isOfficial) - Number(a.package.isOfficial) ||
            b.package.updatedAt - a.package.updatedAt ||
            a.package.name.localeCompare(b.package.name),
        )
        .slice(0, limit)
        .map((entry) => entry.package),
      nextCursor: null,
    };
  }

  const decodedCursor = decodePluginCatalogCursor(params.cursor);
  const requests = await Promise.all(
    families.map(async (family) => {
      const source = family === "code-plugin" ? decodedCursor.code : decodedCursor.bundle;
      if (source.done && source.offset === 0) {
        return {
          family,
          source,
          items: [] as PackageListItem[],
          nextCursor: null,
          effectivePageSize: source.pageSize,
          pageCursor: source.cursor,
          isDone: true,
        };
      }
      const effectivePageSize =
        source.offset > 0 && source.pageSize
          ? Math.max(source.pageSize, source.offset + 1)
          : Math.max(limit * 3, limit);
      const response = await fetchPackages({
        family,
        cursor: source.cursor ?? undefined,
        isOfficial: params.isOfficial,
        executesCode: params.executesCode,
        limit: effectivePageSize,
      });
      if ("results" in response) {
        throw new Error("Expected list response for plugin catalog browse");
      }
      return {
        family,
        source,
        items: response.items,
        nextCursor: response.nextCursor,
        effectivePageSize,
        pageCursor: source.cursor,
        isDone: response.nextCursor === null,
      };
    }),
  );

  const indexes: Record<PluginFamily, number> = {
    "code-plugin": decodedCursor.code.offset,
    "bundle-plugin": decodedCursor.bundle.offset,
  };
  const items: PackageListItem[] = [];

  while (items.length < limit) {
    const codeRequest = requests.find((entry) => entry.family === "code-plugin");
    const bundleRequest = requests.find((entry) => entry.family === "bundle-plugin");
    const codeItem =
      codeRequest && indexes["code-plugin"] < codeRequest.items.length
        ? codeRequest.items[indexes["code-plugin"]]
        : undefined;
    const bundleItem =
      bundleRequest && indexes["bundle-plugin"] < bundleRequest.items.length
        ? bundleRequest.items[indexes["bundle-plugin"]]
        : undefined;
    if (!codeItem && !bundleItem) break;
    if (comparePluginListItems(codeItem, bundleItem) <= 0) {
      items.push(codeItem!);
      indexes["code-plugin"] += 1;
    } else {
      items.push(bundleItem!);
      indexes["bundle-plugin"] += 1;
    }
  }

  const nextState: PluginCatalogCursorState = {
    code: { ...DEFAULT_PLUGIN_SOURCE_CURSOR },
    bundle: { ...DEFAULT_PLUGIN_SOURCE_CURSOR },
  };

  for (const request of requests) {
    const nextOffset = indexes[request.family];
    const nextSource =
      nextOffset < request.items.length
        ? {
            cursor: request.pageCursor,
            offset: nextOffset,
            pageSize: request.effectivePageSize,
            done: request.isDone,
          }
        : {
            cursor: request.nextCursor,
            offset: 0,
            pageSize: request.effectivePageSize,
            done: request.isDone,
          };
    if (request.family === "code-plugin") {
      nextState.code = nextSource;
    } else {
      nextState.bundle = nextSource;
    }
  }

  const isDone =
    nextState.code.done &&
    nextState.code.offset === 0 &&
    nextState.bundle.done &&
    nextState.bundle.offset === 0;

  return {
    items,
    nextCursor: isDone ? null : encodePluginCatalogCursor(nextState),
  };
}

export async function fetchPackageDetail(name: string) {
  const url = await packageApiUrl(`${ApiRoutes.packages}/${encodeURIComponent(name)}`);
  const response = await packageFetch(url, "application/json");
  if (response.status === 404) {
    return {
      package: null,
      owner: null,
    } satisfies PackageDetailResponse;
  }
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as PackageDetailResponse;
}

export async function fetchPackageVersion(name: string, version: string) {
  const url = await packageApiUrl(
    `${ApiRoutes.packages}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`,
  );
  return await fetchJson<PackageVersionDetail>(url);
}

export async function fetchPackageReadme(name: string, version?: string | null) {
  const variants = ["README.md", "readme.md", "README.mdx", "readme.mdx"];
  for (const path of variants) {
    const url = await packageApiUrl(`${ApiRoutes.packages}/${encodeURIComponent(name)}/file`);
    url.searchParams.set("path", path);
    if (version) url.searchParams.set("version", version);
    const response = await packageFetch(url, "text/plain");
    if (response.ok) return await response.text();
    if (response.status === 403 || response.status === 423) return null;
    if (response.status !== 404) throw new Error(await response.text());
  }
  return null;
}
