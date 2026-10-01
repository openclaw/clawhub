import { publicApiUrl } from "./publicApiUrl";

export type TrendingFeedState = "available" | "empty" | "unavailable";

export type CanonicalTrendingItem = {
  id: string;
  source: "clawhub" | "skills-sh";
  slug: string;
  displayName: string;
  summary: string | null;
  canonicalUrl: string;
  publisher: {
    kind: "user" | "org";
    handle: string | null;
    displayName: string | null;
    image: string | null;
    official: boolean;
  } | null;
  sourceIdentity?: {
    id: string;
    owner: string | null;
    repo: string | null;
    host: string | null;
    lifetimeInstalls: number | null;
  };
  official: boolean;
  featured: boolean;
  metrics: {
    trending24hDownloads: number | null;
    trending24hInstalls: number | null;
    trending24hBookmarks: number | null;
    lifetimeInstalls: number | null;
    lifetimeInstallsPeriod: "lifetime";
    updatedAt: number;
  };
};

type LegacyCanonicalTrendingItem = Omit<CanonicalTrendingItem, "metrics"> & {
  metrics: Omit<CanonicalTrendingItem["metrics"], "trending24hDownloads"> & {
    trending24hDownloads?: number | null;
  };
};

type CanonicalTrendingPage = {
  kind: "skills";
  snapshotId: string;
  snapshotCursor: string;
  generatedAt: string;
  windowHours: 24;
  rankingVersion: string;
  totalItems: number;
  items: CanonicalTrendingItem[];
  nextCursor: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isNullableNumber(value: unknown): value is number | null {
  return (typeof value === "number" && Number.isFinite(value)) || value === null;
}

function isCanonicalPath(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return false;
  try {
    const base = new URL("https://clawhub.invalid");
    const parsed = new URL(value, base);
    return (
      parsed.origin === base.origin &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.pathname === value
    );
  } catch {
    return false;
  }
}

function isCanonicalPublisher(value: unknown): value is CanonicalTrendingItem["publisher"] {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (
    (value.kind === "user" || value.kind === "org") &&
    isNullableString(value.handle) &&
    isNullableString(value.displayName) &&
    isNullableString(value.image) &&
    typeof value.official === "boolean"
  );
}

function isCanonicalSourceIdentity(
  value: unknown,
): value is NonNullable<CanonicalTrendingItem["sourceIdentity"]> {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    isNullableString(value.owner) &&
    isNullableString(value.repo) &&
    isNullableString(value.host) &&
    isNullableNumber(value.lifetimeInstalls)
  );
}

function isCanonicalTrendingItem(value: unknown): value is LegacyCanonicalTrendingItem {
  if (!isRecord(value) || !isRecord(value.metrics)) return false;
  return (
    typeof value.id === "string" &&
    (value.source === "clawhub" || value.source === "skills-sh") &&
    typeof value.slug === "string" &&
    typeof value.displayName === "string" &&
    isNullableString(value.summary) &&
    isCanonicalPath(value.canonicalUrl) &&
    isCanonicalPublisher(value.publisher) &&
    (value.sourceIdentity === undefined || isCanonicalSourceIdentity(value.sourceIdentity)) &&
    typeof value.official === "boolean" &&
    typeof value.featured === "boolean" &&
    (value.metrics.trending24hDownloads === undefined ||
      isNullableNumber(value.metrics.trending24hDownloads)) &&
    isNullableNumber(value.metrics.trending24hInstalls) &&
    isNullableNumber(value.metrics.trending24hBookmarks) &&
    isNullableNumber(value.metrics.lifetimeInstalls) &&
    value.metrics.lifetimeInstallsPeriod === "lifetime" &&
    typeof value.metrics.updatedAt === "number" &&
    Number.isFinite(value.metrics.updatedAt)
  );
}

function parseCanonicalTrendingPage(value: unknown): CanonicalTrendingPage {
  if (
    !isRecord(value) ||
    value.kind !== "skills" ||
    typeof value.snapshotId !== "string" ||
    typeof value.snapshotCursor !== "string" ||
    typeof value.generatedAt !== "string" ||
    value.windowHours !== 24 ||
    typeof value.rankingVersion !== "string" ||
    typeof value.totalItems !== "number" ||
    !Array.isArray(value.items) ||
    !value.items.every(isCanonicalTrendingItem) ||
    !(typeof value.nextCursor === "string" || value.nextCursor === null)
  ) {
    throw new Error("Invalid canonical Trending response");
  }
  const page = value as Omit<CanonicalTrendingPage, "items"> & {
    items: LegacyCanonicalTrendingItem[];
  };
  return {
    ...page,
    items: page.items.map((item) => ({
      ...item,
      metrics: {
        ...item.metrics,
        trending24hDownloads: item.metrics.trending24hDownloads ?? null,
      },
    })),
  };
}

export async function fetchCanonicalTrendingPage({
  cursor,
  limit,
  signal,
}: {
  cursor?: string | null;
  limit: number;
  signal?: AbortSignal;
}) {
  const url = publicApiUrl("/api/v1/trending");
  url.searchParams.set("kind", "skills");
  url.searchParams.set("limit", String(limit));
  // nextCursor is opaque and already encodes both snapshotId and page offset.
  // snapshotCursor is metadata for offset zero, not an additional request field.
  if (cursor) url.searchParams.set("cursor", cursor);

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials:
      typeof window !== "undefined" && url.origin === window.location.origin ? "include" : "omit",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || `Trending request failed with status ${response.status}`);
  }
  return parseCanonicalTrendingPage(await response.json());
}
