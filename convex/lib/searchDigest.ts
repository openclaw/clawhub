import type { Infer } from "convex/values";
import type { searchDigestValidator } from "./searchDigestContract";
import { SEARCH_DIGEST_THRESHOLD } from "./searchIntentClassifier";

type DigestSourceCounts = { "clawhub-web": number; "openclaw-control-ui": number };
type DigestInputRow = {
  query: string;
  searches7d: number;
  searchesPrevious7d: number;
  officialGaps7d: number;
  searchUrl: string;
  classification: { intentKind: string; confidence: number; companyProductName?: string } | null;
  featuredCandidate: {
    name: string;
    displayName: string;
    url: string;
    eligibleForFeatured: boolean;
    isFeatured: boolean;
  } | null;
};
type DigestInput = {
  weekEnd: number;
  siteUrl: string;
  totalSearches7d: number;
  sources7d: DigestSourceCounts;
  classificationStatus: "available" | "partial" | "unavailable";
  currentMetadataStatus: "available" | "unavailable";
  truncated: boolean;
  rows: DigestInputRow[];
  moverRows?: DigestInputRow[];
  coverage?: {
    dataThrough: number | null;
    collectionStartedAt: number | null;
    gapStart: number | null;
    gapEnd: number | null;
  };
};

export function buildSearchDigest(input: DigestInput): SearchDigest {
  const site = new URL(input.siteUrl);
  const absolute = (path: string) => {
    const url = new URL(path, site);
    if (url.origin !== site.origin) throw new Error("Digest link outside ClawHub origin");
    return url.toString();
  };
  const tie = (a: DigestInputRow, b: DigestInputRow) =>
    a.query < b.query ? -1 : a.query > b.query ? 1 : 0;
  const demand = (a: DigestInputRow, b: DigestInputRow) => b.searches7d - a.searches7d || tie(a, b);
  const row = (entry: DigestInputRow) => ({
    query: entry.query,
    searches: entry.searches7d,
    previousSearches: entry.searchesPrevious7d,
    officialGaps: entry.officialGaps7d,
    searchUrl: absolute(entry.searchUrl),
  });
  const eligible = input.rows.filter((entry) => entry.searches7d >= SEARCH_DIGEST_THRESHOLD);
  const gaps = eligible
    .filter((entry) => entry.officialGaps7d >= SEARCH_DIGEST_THRESHOLD)
    .sort((a, b) => b.officialGaps7d - a.officialGaps7d || demand(a, b));
  return {
    kind: "plugin_search_weekly" as const,
    weekStart: input.weekEnd - 604_800_000,
    weekEnd: input.weekEnd,
    minimumSearches: SEARCH_DIGEST_THRESHOLD,
    dashboardUrl: absolute(`/management?view=search-insights&endDay=${input.weekEnd}`),
    totalSearches: input.totalSearches7d,
    sourceCounts: {
      clawhubWeb: input.sources7d["clawhub-web"],
      openclawControlUi: input.sources7d["openclaw-control-ui"],
    },
    classificationStatus: input.classificationStatus,
    currentMetadataStatus: input.currentMetadataStatus,
    truncated: input.truncated,
    coverage: {
      dataThrough: input.coverage?.dataThrough ?? null,
      collectionStartedAt: input.coverage?.collectionStartedAt ?? null,
      gapStart: input.coverage?.gapStart ?? null,
      gapEnd: input.coverage?.gapEnd ?? null,
    },
    companyOpportunities:
      input.classificationStatus === "unavailable"
        ? []
        : gaps
            .filter(
              (entry) =>
                entry.classification?.intentKind === "company_product" &&
                entry.classification.confidence >= 0.8,
            )
            .slice(0, 5)
            .map((entry) => ({
              ...row(entry),
              ...(entry.classification?.companyProductName
                ? { companyProductName: entry.classification.companyProductName }
                : {}),
              confidence: entry.classification!.confidence,
            })),
    officialGaps: gaps.slice(0, 5).map(row),
    featuredCandidates: eligible
      .filter(
        (entry) =>
          entry.featuredCandidate?.eligibleForFeatured && !entry.featuredCandidate.isFeatured,
      )
      .sort(demand)
      .slice(0, 5)
      .map((entry) => ({
        ...row(entry),
        package: {
          name: entry.featuredCandidate!.name,
          displayName: entry.featuredCandidate!.displayName,
          url: absolute(entry.featuredCandidate!.url),
        },
      })),
    movers: (input.moverRows ?? input.rows)
      .filter(
        (entry) =>
          Math.max(entry.searches7d, entry.searchesPrevious7d) >= SEARCH_DIGEST_THRESHOLD &&
          entry.searches7d !== entry.searchesPrevious7d,
      )
      .sort(
        (a, b) =>
          Math.abs(b.searches7d - b.searchesPrevious7d) -
            Math.abs(a.searches7d - a.searchesPrevious7d) || tie(a, b),
      )
      .slice(0, 5)
      .map(row),
  };
}

export type SearchDigest = Infer<typeof searchDigestValidator>;

/** Completed UTC week, released on Monday at/after 09:00 America/Los_Angeles. */
export function mondaySearchWeek(now: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  if (value("weekday") !== "Mon" || Number(value("hour")) < 9) return null;
  const weekEnd = Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day")));
  return { weekStart: weekEnd - 7 * 24 * 60 * 60 * 1000, weekEnd };
}
