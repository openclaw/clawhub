import { api } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { json, text } from "./shared";

const FEED_SCHEMA_VERSION = 1;
const FEED_HASH_ALGORITHM = "sha256";
const MAX_ROOT_FEED_LIMIT = 5_000;

const FEED_DEFINITIONS = {
  all: {
    id: "clawhub-all",
    path: "/api/v1/feeds/all",
    title: "All ClawHub catalog entries",
    description: "All public ClawHub skills and installable plugins.",
    types: ["skill", "plugin"],
  },
  official: {
    id: "clawhub-official",
    path: "/api/v1/feeds/official",
    title: "Official ClawHub catalog entries",
    description: "Catalog entries marked official by ClawHub/OpenClaw.",
    types: ["skill", "plugin"],
  },
  community: {
    id: "clawhub-community",
    path: "/api/v1/feeds/community",
    title: "Community ClawHub catalog entries",
    description: "Public non-official ClawHub catalog entries.",
    types: ["skill", "plugin"],
  },
  reviewed: {
    id: "clawhub-reviewed",
    path: "/api/v1/feeds/reviewed",
    title: "Reviewed ClawHub catalog entries",
    description: "Public entries that meet ClawHub's current review criteria.",
    types: ["skill", "plugin"],
    criteria:
      "clean scans or moderation signals plus available verification metadata where applicable",
  },
} as const;

const TYPE_FILTERS = {
  all: {
    includeSkills: true,
    includePlugins: true,
    types: ["skill", "plugin"],
  },
  skill: {
    includeSkills: true,
    includePlugins: false,
    types: ["skill"],
  },
  skills: {
    includeSkills: true,
    includePlugins: false,
    types: ["skill"],
  },
  plugin: {
    includeSkills: false,
    includePlugins: true,
    types: ["plugin"],
  },
  plugins: {
    includeSkills: false,
    includePlugins: true,
    types: ["plugin"],
  },
} as const;

const apiRefs = api as unknown as {
  feeds: {
    rootFeed: unknown;
  };
};

type RootFeedResult = {
  generatedAtMs: number;
  limit: number;
  truncated: boolean;
  skills: SkillDigest[];
  packages: PackageDigest[];
};

type SkillDigest = {
  slug: string;
  displayName: string;
  ownerUserId: string;
  summary?: string;
  ownerHandle?: string;
  ownerDisplayName?: string;
  latestVersionSummary?: { version: string };
  capabilityTags?: string[];
  moderationStatus?: string;
  isSuspicious?: boolean;
  statsDownloads?: number;
  statsStars?: number;
  statsInstallsCurrent?: number;
  statsInstallsAllTime?: number;
  updatedAt: number;
};

type PackageDigest = {
  name: string;
  displayName: string;
  summary?: string;
  family: "skill" | "code-plugin" | "bundle-plugin";
  channel: "official" | "community" | "private";
  isOfficial: boolean;
  ownerHandle?: string;
  latestVersion?: string;
  runtimeId?: string;
  capabilityTags?: string[];
  executesCode?: boolean;
  verificationTier?: string;
  scanStatus?: string;
  updatedAt: number;
};

type FeedPackageType = "skill" | "plugin" | "connector";

type FeedDocument = {
  schemaVersion: 1;
  feedId: string;
  scope: { kind: "root" };
  generatedAt: string;
  sourceRevision?: string;
  entries: FeedPackageEntry[];
  attestation?: {
    algorithm: "sha256";
    hash: string;
  };
};

type FeedDefinition = (typeof FEED_DEFINITIONS)[keyof typeof FEED_DEFINITIONS];

type FeedPackageEntry = {
  id: string;
  type: FeedPackageType;
  version: string;
  title: string;
  description?: string;
  publisher?: string;
  source: {
    registry: "clawhub";
    package: string;
    url?: string;
  };
  artifactSha256?: string;
  updatedAt?: string;
  metadata?: Record<string, string>;
};

function parsePositiveInt(value: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(parsed, MAX_ROOT_FEED_LIMIT);
}

function parseTypeFilter(value: string | null) {
  if (!value) return TYPE_FILTERS.all;
  return value in TYPE_FILTERS ? TYPE_FILTERS[value as keyof typeof TYPE_FILTERS] : null;
}

function isoFromMillis(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return "1970-01-01T00:00:00Z";
  return new Date(value).toISOString().replace(".000Z", "Z");
}

function maybeSet(metadata: Record<string, string>, key: string, value: unknown) {
  if (value === undefined || value === null) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    metadata[key] = String(value);
  }
}

function sortedMetadata(metadata: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function skillUrl(skill: SkillDigest) {
  const ownerSegment = skill.ownerHandle?.trim() || skill.ownerUserId;
  return `/${encodeURIComponent(ownerSegment)}/${encodeURIComponent(skill.slug)}`;
}

function skillEntry(skill: SkillDigest): FeedPackageEntry {
  const metadata: Record<string, string> = {};
  maybeSet(metadata, "clawhub.moderationStatus", skill.moderationStatus);
  maybeSet(metadata, "clawhub.isSuspicious", skill.isSuspicious);
  maybeSet(metadata, "clawhub.statsDownloads", skill.statsDownloads);
  maybeSet(metadata, "clawhub.statsStars", skill.statsStars);
  maybeSet(metadata, "clawhub.statsInstallsCurrent", skill.statsInstallsCurrent);
  maybeSet(metadata, "clawhub.statsInstallsAllTime", skill.statsInstallsAllTime);
  maybeSet(metadata, "clawhub.capabilityTags", skill.capabilityTags?.join(","));

  return compactEntry({
    id: skill.slug,
    type: "skill",
    version: skill.latestVersionSummary?.version ?? "latest",
    title: skill.displayName,
    description: skill.summary,
    publisher: skill.ownerHandle ?? skill.ownerDisplayName,
    source: {
      registry: "clawhub",
      package: skill.slug,
      url: skillUrl(skill),
    },
    updatedAt: isoFromMillis(skill.updatedAt),
    metadata: sortedMetadata(metadata),
  });
}

function pluginUrl(pkg: PackageDigest) {
  if (pkg.name.startsWith("@")) {
    const slashIndex = pkg.name.indexOf("/");
    if (
      slashIndex > 1 &&
      slashIndex < pkg.name.length - 1 &&
      pkg.name.indexOf("/", slashIndex + 1) === -1
    ) {
      return `/plugins/@${encodeURIComponent(pkg.name.slice(1, slashIndex))}/${encodeURIComponent(
        pkg.name.slice(slashIndex + 1),
      )}`;
    }
  }
  return `/plugins/${encodeURIComponent(pkg.name)}`;
}

function packageEntry(pkg: PackageDigest): FeedPackageEntry {
  const metadata: Record<string, string> = {};
  maybeSet(metadata, "clawhub.family", pkg.family);
  maybeSet(metadata, "clawhub.channel", pkg.channel);
  maybeSet(metadata, "clawhub.isOfficial", pkg.isOfficial);
  maybeSet(metadata, "clawhub.runtimeId", pkg.runtimeId);
  maybeSet(metadata, "clawhub.executesCode", pkg.executesCode);
  maybeSet(metadata, "clawhub.verificationTier", pkg.verificationTier);
  maybeSet(metadata, "clawhub.scanStatus", pkg.scanStatus);
  maybeSet(metadata, "clawhub.capabilityTags", pkg.capabilityTags?.join(","));

  return compactEntry({
    id: pkg.name,
    type: "plugin",
    version: pkg.latestVersion ?? "latest",
    title: pkg.displayName,
    description: pkg.summary,
    publisher: pkg.ownerHandle,
    source: {
      registry: "clawhub",
      package: pkg.name,
      url: pluginUrl(pkg),
    },
    updatedAt: isoFromMillis(pkg.updatedAt),
    metadata: sortedMetadata(metadata),
  });
}

function compactEntry(entry: FeedPackageEntry): FeedPackageEntry {
  const metadata =
    entry.metadata && Object.keys(entry.metadata).length > 0 ? entry.metadata : undefined;
  return {
    id: entry.id,
    type: entry.type,
    version: entry.version,
    title: entry.title,
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.publisher ? { publisher: entry.publisher } : {}),
    source: entry.source,
    ...(entry.artifactSha256 ? { artifactSha256: entry.artifactSha256 } : {}),
    ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function canonicalBody(feed: FeedDocument) {
  const entries = [...feed.entries].sort((left, right) =>
    [
      left.type,
      left.id,
      left.version,
      left.source.registry,
      left.source.package,
      left.source.url ?? "",
      left.title ?? "",
      left.description ?? "",
      left.publisher ?? "",
      left.artifactSha256 ?? "",
      left.updatedAt ?? "",
      JSON.stringify(left.metadata ?? {}),
    ]
      .join("\u0000")
      .localeCompare(
        [
          right.type,
          right.id,
          right.version,
          right.source.registry,
          right.source.package,
          right.source.url ?? "",
          right.title ?? "",
          right.description ?? "",
          right.publisher ?? "",
          right.artifactSha256 ?? "",
          right.updatedAt ?? "",
          JSON.stringify(right.metadata ?? {}),
        ].join("\u0000"),
      ),
  );
  return {
    schemaVersion: feed.schemaVersion,
    feedId: feed.feedId,
    scope: feed.scope,
    generatedAt: feed.generatedAt,
    ...(feed.sourceRevision ? { sourceRevision: feed.sourceRevision } : {}),
    entries,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableCanonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableCanonicalize);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, stableCanonicalize(entryValue)]),
  );
}

async function sha256Hex(contents: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(contents));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildRootFeedDocument(
  result: RootFeedResult,
  definition: FeedDefinition = FEED_DEFINITIONS.all,
): Promise<FeedDocument> {
  const entries = [...result.skills.map(skillEntry), ...result.packages.map(packageEntry)];
  const feed: FeedDocument = {
    schemaVersion: FEED_SCHEMA_VERSION,
    feedId: definition.id,
    scope: { kind: "root" },
    generatedAt: isoFromMillis(result.generatedAtMs),
    sourceRevision: `clawhub-digest:feed=${definition.id};limit=${result.limit};truncated=${result.truncated}`,
    entries,
  };
  const hash = await sha256Hex(JSON.stringify(stableCanonicalize(canonicalBody(feed))));
  return {
    ...feed,
    entries: canonicalBody(feed).entries,
    attestation: {
      algorithm: FEED_HASH_ALGORITHM,
      hash,
    },
  };
}

export async function feedsIndexV1Handler(_ctx: ActionCtx, request: Request) {
  const origin = new URL(request.url).origin;
  return json(
    {
      schemaVersion: 1,
      feeds: Object.values(FEED_DEFINITIONS).map((feed) => ({
        id: feed.id,
        title: feed.title,
        description: feed.description,
        url: `${origin}${feed.path}`,
        types: feed.types,
        schemaVersion: FEED_SCHEMA_VERSION,
        ...("criteria" in feed ? { criteria: feed.criteria } : {}),
        attestation: {
          algorithm: FEED_HASH_ALGORITHM,
          required: true,
        },
      })),
    },
    200,
    {
      "Cache-Control": "public, max-age=300",
    },
  );
}

async function feedV1Handler(ctx: ActionCtx, request: Request, definition: FeedDefinition) {
  const url = new URL(request.url);
  const typeFilter = parseTypeFilter(url.searchParams.get("type"));
  if (!typeFilter) return text("invalid feed type", 400);

  const queryArgs = {
    feed: definition.id.replace(/^clawhub-/, ""),
    limit: parsePositiveInt(url.searchParams.get("limit")),
    includeSkills: typeFilter.includeSkills,
    includePlugins: typeFilter.includePlugins,
  };
  const result = (await ctx.runQuery(
    apiRefs.feeds.rootFeed as never,
    queryArgs as never,
  )) as RootFeedResult;

  return json(await buildRootFeedDocument(result, definition), 200, {
    "Cache-Control": "public, max-age=300",
  });
}

export async function allFeedV1Handler(ctx: ActionCtx, request: Request) {
  return await feedV1Handler(ctx, request, FEED_DEFINITIONS.all);
}

export async function officialFeedV1Handler(ctx: ActionCtx, request: Request) {
  return await feedV1Handler(ctx, request, FEED_DEFINITIONS.official);
}

export async function communityFeedV1Handler(ctx: ActionCtx, request: Request) {
  return await feedV1Handler(ctx, request, FEED_DEFINITIONS.community);
}

export async function reviewedFeedV1Handler(ctx: ActionCtx, request: Request) {
  return await feedV1Handler(ctx, request, FEED_DEFINITIONS.reviewed);
}
