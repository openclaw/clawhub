import { getAuthUserId } from "@convex-dev/auth/server";
import {
  PackagePublishRequestSchema,
  PackageTrustedPublisherUpsertRequestSchema,
  PublishTokenMintRequestSchema,
  parseArk,
} from "clawhub-schema";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getOptionalApiTokenUserId } from "../lib/apiTokenAuth";
import {
  fetchGitHubRepositoryIdentity,
  verifyGitHubActionsTrustedPublishJwt,
} from "../lib/githubActionsOidc";
import { corsHeaders, mergeHeaders } from "../lib/httpHeaders";
import { applyRateLimit } from "../lib/httpRateLimit";
import { getPackageDownloadSecurityBlock } from "../lib/packageSecurity";
import { getPublishFileSizeError, MAX_PUBLISH_FILE_BYTES } from "../lib/publishLimits";
import { isMacJunkPath, isTextFile } from "../lib/skills";
import { buildDeterministicPackageZip } from "../lib/skillZip";
import { generateToken, hashToken } from "../lib/tokens";
import {
  MAX_RAW_FILE_BYTES,
  getPathSegments,
  json,
  resolveTagsBatch,
  requireApiTokenUserOrResponse,
  requirePackagePublishAuthOrResponse,
  safeTextFileResponse,
  text,
  toOptionalNumber,
} from "./shared";
const apiRefs = api as unknown as {
  packages: {
    listPublicPage: unknown;
    searchPublic: unknown;
  };
  skills: {
    listPackageCatalogPage: unknown;
    searchPackageCatalogPublic: unknown;
    getBySlug: unknown;
    listVersionsPage: unknown;
    getVersionBySkillAndVersion: unknown;
  };
};
const internalRefs = internal as unknown as {
  packages: {
    getByNameForViewerInternal: unknown;
    listPageForViewerInternal: unknown;
    searchForViewerInternal: unknown;
    listVersionsForViewerInternal: unknown;
    getPackageByNameInternal: unknown;
    getTrustedPublisherByPackageIdInternal: unknown;
    getVersionByNameForViewerInternal: unknown;
    publishPackageForUserInternal: unknown;
    publishPackageForTrustedPublisherInternal: unknown;
    setTrustedPublisherForUserInternal: unknown;
    deleteTrustedPublisherForUserInternal: unknown;
    getReleasesByIdsInternal: unknown;
    getReleaseByPackageAndVersionInternal: unknown;
    getReleaseByIdInternal: unknown;
    insertAuditLogInternal: unknown;
  };
  packagePublishTokens: {
    createInternal: unknown;
  };
  skills: {
    getSkillBySlugInternal: unknown;
    getVersionByIdInternal: unknown;
    getVersionBySkillAndVersionInternal: unknown;
  };
};

async function runQueryRef<T>(ctx: ActionCtx, ref: unknown, args: unknown): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

async function runActionRef<T>(ctx: ActionCtx, ref: unknown, args: unknown): Promise<T> {
  return (await ctx.runAction(ref as never, args as never)) as T;
}

async function runMutationRef<T>(ctx: ActionCtx, ref: unknown, args: unknown): Promise<T> {
  return (await ctx.runMutation(ref as never, args as never)) as T;
}

async function getOptionalViewerUserIdForRequest(ctx: ActionCtx, request: Request) {
  const apiTokenUserId = await getOptionalApiTokenUserId(ctx, request);
  if (apiTokenUserId) return apiTokenUserId;
  try {
    const userId = (await getAuthUserId(ctx)) ?? null;
    if (!userId) return null;
    const user = await runQueryRef<Doc<"users"> | null>(ctx, internal.users.getByIdInternal, {
      userId,
    });
    if (!user || user.deletedAt || user.deactivatedAt) return null;
    return userId;
  } catch {
    // Public package reads should degrade to anonymous when cookie-backed auth is stale.
    return null;
  }
}

type PackageListQueryArgs = {
  family?: "skill" | "code-plugin" | "bundle-plugin";
  channel?: "official" | "community" | "private";
  isOfficial?: boolean;
  executesCode?: boolean;
  capabilityTag?: string;
  viewerUserId?: Id<"users">;
  paginationOpts: { cursor: string | null; numItems: number };
};

type SkillPackageDocLike = {
  _id: Id<"skills">;
  slug: string;
  displayName: string;
  summary?: string | null;
  latestVersionId?: Id<"skillVersions">;
  tags: Record<string, Id<"skillVersions">>;
  stats?: unknown;
  createdAt: number;
  updatedAt: number;
  badges?: { official?: unknown };
};

type SkillVersionLike = {
  _id: Id<"skillVersions">;
  skillId: Id<"skills">;
  version: string;
  createdAt: number;
  changelog: string;
  files: Array<{
    path: string;
    size: number;
    sha256: string;
    storageId?: Id<"_storage">;
    contentType?: string;
  }>;
  softDeletedAt?: number;
};

type ReleaseLike = {
  _id: Id<"packageReleases">;
  version: string;
  createdAt: number;
  changelog: string;
  distTags?: string[];
  files: Array<{
    path: string;
    size: number;
    sha256: string;
    storageId: Id<"_storage">;
    contentType?: string;
  }>;
  compatibility?: Doc<"packageReleases">["compatibility"];
  capabilities?: Doc<"packageReleases">["capabilities"];
  verification?: Doc<"packageReleases">["verification"];
  sha256hash?: string;
  vtAnalysis?: Doc<"packageReleases">["vtAnalysis"];
  llmAnalysis?: Doc<"packageReleases">["llmAnalysis"];
  staticScan?: Doc<"packageReleases">["staticScan"];
  integritySha256?: string;
  softDeletedAt?: number;
};

type PackageTrustedPublisherLike = {
  _id: Id<"packageTrustedPublishers">;
  packageId: Id<"packages">;
  provider: "github-actions";
  repository: string;
  repositoryId: string;
  repositoryOwner: string;
  repositoryOwnerId: string;
  workflowFilename: string;
  environment?: string;
  createdAt: number;
  updatedAt: number;
};

function toVisibleRelease(release: ReleaseLike | null) {
  if (!release || ("softDeletedAt" in release && release.softDeletedAt !== undefined)) return null;
  return release;
}

function toPublicTrustedPublisher(trustedPublisher: PackageTrustedPublisherLike | null) {
  if (!trustedPublisher) return null;
  return {
    provider: trustedPublisher.provider,
    repository: trustedPublisher.repository,
    repositoryId: trustedPublisher.repositoryId,
    repositoryOwner: trustedPublisher.repositoryOwner,
    repositoryOwnerId: trustedPublisher.repositoryOwnerId,
    workflowFilename: trustedPublisher.workflowFilename,
    ...(trustedPublisher.environment ? { environment: trustedPublisher.environment } : {}),
  };
}

function getReleaseSecurityBlock(release: ReleaseLike) {
  return getPackageDownloadSecurityBlock(release);
}

async function resolvePackageTags(
  ctx: ActionCtx,
  tags: Record<string, Id<"packageReleases">>,
): Promise<Record<string, string>> {
  const releaseIds = Object.values(tags);
  if (releaseIds.length === 0) return {};
  const releases = await runQueryRef<ReleaseLike[]>(
    ctx,
    internalRefs.packages.getReleasesByIdsInternal,
    {
      releaseIds,
    },
  );
  const byId = new Map(releases.map((release) => [release._id, release.version]));
  return Object.fromEntries(
    Object.entries(tags)
      .map(([tag, releaseId]) => [tag, byId.get(releaseId)])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

type CatalogListItem = {
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

type CatalogSearchEntry = { score: number; package: CatalogListItem };

type CatalogSourceCursorState = {
  cursor: string | null;
  offset: number;
  pageSize: number | null;
  done: boolean;
};

type UnifiedCatalogCursorState = {
  packages: CatalogSourceCursorState;
  skills: CatalogSourceCursorState;
};

type CatalogPageResult = {
  page: CatalogListItem[];
  isDone: boolean;
  continueCursor: string;
};

type CatalogSourceState = {
  state: CatalogSourceCursorState;
  page: CatalogPageResult | null;
  pageCursor: string | null;
  index: number;
};

const UNIFIED_CATALOG_CURSOR_PREFIX = "pkgcatalog:";

function defaultCatalogSourceCursorState(): CatalogSourceCursorState {
  return { cursor: null, offset: 0, pageSize: null, done: false };
}

function encodeUnifiedCatalogCursor(state: UnifiedCatalogCursorState) {
  return `${UNIFIED_CATALOG_CURSOR_PREFIX}${JSON.stringify(state)}`;
}

function decodeUnifiedCatalogCursor(raw: string | null | undefined): UnifiedCatalogCursorState {
  if (!raw?.startsWith(UNIFIED_CATALOG_CURSOR_PREFIX)) {
    return {
      packages: { ...defaultCatalogSourceCursorState(), cursor: raw ?? null },
      skills: defaultCatalogSourceCursorState(),
    };
  }
  try {
    const parsed = JSON.parse(
      raw.slice(UNIFIED_CATALOG_CURSOR_PREFIX.length),
    ) as Partial<UnifiedCatalogCursorState>;
    const normalize = (
      input: Partial<CatalogSourceCursorState> | undefined,
    ): CatalogSourceCursorState => ({
      cursor: typeof input?.cursor === "string" ? input.cursor : null,
      offset: typeof input?.offset === "number" && input.offset > 0 ? input.offset : 0,
      pageSize: typeof input?.pageSize === "number" && input.pageSize > 0 ? input.pageSize : null,
      done: input?.done === true,
    });
    return {
      packages: normalize(parsed.packages),
      skills: normalize(parsed.skills),
    };
  } catch {
    return {
      packages: defaultCatalogSourceCursorState(),
      skills: defaultCatalogSourceCursorState(),
    };
  }
}

function initCatalogSource(state: CatalogSourceCursorState): CatalogSourceState {
  return {
    state: { ...state },
    page: null,
    pageCursor: state.cursor,
    index: state.offset,
  };
}

function finalizeCatalogSource(source: CatalogSourceState): CatalogSourceCursorState {
  if (!source.page) return source.state;
  if (source.index < source.page.page.length) {
    return {
      cursor: source.pageCursor,
      offset: source.index,
      pageSize: source.state.pageSize,
      done: source.page.isDone,
    };
  }
  return {
    cursor: source.page.continueCursor,
    offset: 0,
    pageSize: source.state.pageSize,
    done: source.page.isDone,
  };
}

async function ensureCatalogSourcePage(
  source: CatalogSourceState,
  pageSize: number,
  fetchPage: (cursor: string | null, pageSize: number) => Promise<CatalogPageResult>,
) {
  while (true) {
    if (!source.page) {
      if (source.state.done && source.state.offset === 0) return null;
      const effectivePageSize = source.state.pageSize ?? pageSize;
      source.pageCursor = source.state.cursor;
      source.page = await fetchPage(source.pageCursor, effectivePageSize);
      source.state.pageSize = effectivePageSize;
      source.index = source.state.offset;
    }

    if (source.index < source.page.page.length) {
      return source.page.page[source.index];
    }

    if (source.page.isDone) return null;

    source.state.cursor = source.page.continueCursor;
    source.state.offset = 0;
    source.state.done = source.page.isDone;
    source.page = null;
    source.pageCursor = source.state.cursor;
    source.index = 0;
  }
}

function compareCatalogItems(a: CatalogListItem, b: CatalogListItem) {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.family !== b.family) return a.family.localeCompare(b.family);
  return a.name.localeCompare(b.name);
}

async function resolveSkillTags(
  ctx: ActionCtx,
  tags: Record<string, Id<"skillVersions">>,
): Promise<Record<string, string>> {
  const [resolved] = await resolveTagsBatch(ctx, [tags]);
  return resolved ?? {};
}

function isSkillOfficial(skill: SkillPackageDocLike) {
  return Boolean(skill.badges?.official);
}

function toSkillPackageDetail(
  skill: SkillPackageDocLike,
  latestVersion: SkillVersionLike | null,
  owner: { handle?: string; displayName?: string; image?: string } | null,
  resolvedTags: Record<string, string>,
) {
  return {
    package: {
      name: skill.slug,
      displayName: skill.displayName,
      family: "skill" as const,
      runtimeId: null,
      channel: isSkillOfficial(skill) ? ("official" as const) : ("community" as const),
      isOfficial: isSkillOfficial(skill),
      summary: skill.summary ?? null,
      ownerHandle: owner?.handle ?? null,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
      latestVersion: latestVersion?.version ?? null,
      tags: resolvedTags,
      compatibility: null,
      capabilities: null,
      verification: null,
    },
    owner: owner
      ? {
          handle: owner.handle ?? null,
          displayName: owner.displayName ?? null,
          image: owner.image ?? null,
        }
      : null,
  };
}

function skillVersionTags(tags: Record<string, string>, version: string) {
  return Object.entries(tags)
    .filter(([, taggedVersion]) => taggedVersion === version)
    .map(([tag]) => tag);
}

function parsePackagePublishBody(body: unknown) {
  const parsed = parseArk(PackagePublishRequestSchema, body, "Package publish payload") as {
    name: string;
    displayName?: string;
    ownerHandle?: string;
    family: "skill" | "code-plugin" | "bundle-plugin";
    version: string;
    changelog: string;
    manualOverrideReason?: string;
    channel?: "official" | "community" | "private";
    tags?: string[];
    source?: Record<string, unknown>;
    bundle?: Record<string, unknown>;
    files: Array<{
      path: string;
      size: number;
      storageId: string;
      sha256: string;
      contentType?: string;
    }>;
  };
  if (parsed.files.length === 0) throw new Error("files required");
  return {
    name: parsed.name,
    displayName: parsed.displayName ?? undefined,
    ownerHandle: parsed.ownerHandle?.trim().replace(/^@+/, "") || undefined,
    family: parsed.family,
    version: parsed.version,
    changelog: parsed.changelog,
    manualOverrideReason: parsed.manualOverrideReason?.trim() || undefined,
    channel: parsed.channel ?? undefined,
    tags: parsed.tags?.filter(Boolean) ?? undefined,
    source: parsed.source ?? undefined,
    bundle: parsed.bundle ?? undefined,
    files: parsed.files.map((file) => ({
      ...file,
      storageId: file.storageId as Id<"_storage">,
    })),
  };
}

async function parseMultipartPackagePublish(ctx: ActionCtx, request: Request) {
  const form = await request.formData();
  const payloadRaw = form.get("payload");
  if (!payloadRaw || typeof payloadRaw !== "string") throw new Error("Missing payload");
  const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
  const files: Array<{
    path: string;
    size: number;
    storageId: Id<"_storage">;
    sha256: string;
    contentType?: string;
  }> = [];
  for (const entry of form.getAll("files")) {
    if (typeof entry === "string") continue;
    if (isMacJunkPath(entry.name)) continue;
    if (entry.size > MAX_PUBLISH_FILE_BYTES) {
      throw new Error(getPublishFileSizeError(entry.name));
    }
    const buffer = new Uint8Array(await entry.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const storageId = await ctx.storage.store(entry);
    files.push({
      path: entry.name,
      size: entry.size,
      storageId,
      sha256,
      contentType: entry.type || undefined,
    });
  }
  return parsePackagePublishBody({ ...payload, files });
}

async function listPackages(
  ctx: ActionCtx,
  request: Request,
  family?: PackageListQueryArgs["family"],
  options?: { includeSkills?: boolean },
) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const url = new URL(request.url);
  const viewerUserId = await getOptionalViewerUserIdForRequest(ctx, request);
  const limit = Math.max(1, Math.min(toOptionalNumber(url.searchParams.get("limit")) ?? 25, 100));
  const cursor = url.searchParams.get("cursor");
  const familyRaw = url.searchParams.get("family");
  const channelRaw = url.searchParams.get("channel")?.trim();
  const capabilityTag = url.searchParams.get("capabilityTag")?.trim() || undefined;
  const isOfficialRaw = url.searchParams.get("isOfficial");
  const executesCodeRaw = url.searchParams.get("executesCode");
  const effectiveFamily =
    family ??
    (familyRaw === "skill" || familyRaw === "code-plugin" || familyRaw === "bundle-plugin"
      ? familyRaw
      : undefined);
  const includeSkills = options?.includeSkills ?? effectiveFamily === undefined;
  const channel =
    channelRaw === "official" || channelRaw === "community" || channelRaw === "private"
      ? channelRaw
      : undefined;
  const isOfficial =
    isOfficialRaw === "true" ? true : isOfficialRaw === "false" ? false : undefined;
  const executesCode =
    executesCodeRaw === "true" ? true : executesCodeRaw === "false" ? false : undefined;

  if (effectiveFamily === "skill") {
    const result = await runQueryRef<{
      page: CatalogListItem[];
      isDone: boolean;
      continueCursor: string | null;
    }>(ctx, apiRefs.skills.listPackageCatalogPage, {
      channel,
      isOfficial,
      executesCode,
      capabilityTag,
      paginationOpts: { cursor, numItems: limit },
    });
    return json(
      { items: result.page, nextCursor: result.isDone ? null : result.continueCursor },
      200,
      rate.headers,
    );
  }

  if (!effectiveFamily && includeSkills) {
    const packageSource = initCatalogSource(decodeUnifiedCatalogCursor(cursor).packages);
    const skillSource = initCatalogSource(decodeUnifiedCatalogCursor(cursor).skills);
    const pageSize = limit;
    const items: CatalogListItem[] = [];

    while (items.length < limit) {
      const [packageCandidate, skillCandidate] = await Promise.all([
        ensureCatalogSourcePage(packageSource, pageSize, async (pageCursor, numItems) => {
          const result = await runQueryRef<{
            page: CatalogListItem[];
            isDone: boolean;
            continueCursor: string | null;
          }>(ctx, internalRefs.packages.listPageForViewerInternal, {
            channel,
            isOfficial,
            executesCode,
            capabilityTag,
            viewerUserId: viewerUserId ?? undefined,
            paginationOpts: { cursor: pageCursor, numItems },
          });
          return {
            page: result.page,
            isDone: result.isDone,
            continueCursor: result.continueCursor ?? "",
          };
        }),
        ensureCatalogSourcePage(skillSource, pageSize, async (pageCursor, numItems) => {
          const result = await runQueryRef<{
            page: CatalogListItem[];
            isDone: boolean;
            continueCursor: string | null;
          }>(ctx, apiRefs.skills.listPackageCatalogPage, {
            channel,
            isOfficial,
            executesCode,
            capabilityTag,
            paginationOpts: { cursor: pageCursor, numItems },
          });
          return {
            page: result.page,
            isDone: result.isDone,
            continueCursor: result.continueCursor ?? "",
          };
        }),
      ]);

      if (!packageCandidate && !skillCandidate) break;
      if (
        !skillCandidate ||
        (packageCandidate && compareCatalogItems(packageCandidate, skillCandidate) <= 0)
      ) {
        items.push(packageCandidate!);
        packageSource.index += 1;
      } else {
        items.push(skillCandidate);
        skillSource.index += 1;
      }
    }

    const nextState = {
      packages: finalizeCatalogSource(packageSource),
      skills: finalizeCatalogSource(skillSource),
    };
    const isDoneAll =
      nextState.packages.done &&
      nextState.packages.offset === 0 &&
      nextState.skills.done &&
      nextState.skills.offset === 0;
    return json(
      {
        items,
        nextCursor: isDoneAll ? null : encodeUnifiedCatalogCursor(nextState),
      },
      200,
      rate.headers,
    );
  }

  const result = await runQueryRef<{
    page: unknown[];
    isDone: boolean;
    continueCursor: string | null;
  }>(ctx, internalRefs.packages.listPageForViewerInternal, {
    family: effectiveFamily,
    channel,
    isOfficial,
    executesCode,
    capabilityTag,
    viewerUserId: viewerUserId ?? undefined,
    paginationOpts: { cursor, numItems: limit },
  } satisfies PackageListQueryArgs);
  return json(
    { items: result.page, nextCursor: result.isDone ? null : result.continueCursor },
    200,
    rate.headers,
  );
}

export async function listPackagesV1Handler(ctx: ActionCtx, request: Request) {
  return await listPackages(ctx, request, undefined, { includeSkills: true });
}

export async function listPluginsV1Handler(ctx: ActionCtx, request: Request) {
  return await listPackages(ctx, request, undefined, { includeSkills: false });
}

export async function listCodePluginsV1Handler(ctx: ActionCtx, request: Request) {
  return await listPackages(ctx, request, "code-plugin");
}

export async function listBundlePluginsV1Handler(ctx: ActionCtx, request: Request) {
  return await listPackages(ctx, request, "bundle-plugin");
}

export async function publishPackageV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;

  const auth = await requirePackagePublishAuthOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;

  try {
    const contentType = request.headers.get("content-type") ?? "";
    const payload = contentType.includes("multipart/form-data")
      ? await parseMultipartPackagePublish(ctx, request)
      : parsePackagePublishBody(await request.json());
    const result =
      auth.auth.kind === "user"
        ? await runActionRef(ctx, internalRefs.packages.publishPackageForUserInternal, {
            actorUserId: auth.auth.userId,
            payload,
          })
        : await runActionRef(ctx, internalRefs.packages.publishPackageForTrustedPublisherInternal, {
            publishTokenId: auth.auth.publishToken._id,
            payload,
          });
    return json(result, 200, rate.headers);
  } catch (error) {
    return text(error instanceof Error ? error.message : "Publish failed", 400, rate.headers);
  }
}

async function getPackageAndTrustedPublisherByName(ctx: ActionCtx, packageName: string) {
  const pkg = await runQueryRef<Doc<"packages"> | null>(
    ctx,
    internalRefs.packages.getPackageByNameInternal,
    {
      name: packageName,
    },
  );
  if (!pkg || pkg.softDeletedAt) return { pkg: null, trustedPublisher: null };
  const trustedPublisher = await runQueryRef<PackageTrustedPublisherLike | null>(
    ctx,
    internalRefs.packages.getTrustedPublisherByPackageIdInternal,
    { packageId: pkg._id },
  );
  return { pkg, trustedPublisher };
}

export async function mintPublishTokenV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;

  const parsedBody = await request.json().catch(() => null);
  if (!parsedBody) return text("Invalid JSON", 400, rate.headers);

  try {
    const payload = parseArk(
      PublishTokenMintRequestSchema,
      parsedBody,
      "Publish token mint payload",
    ) as {
      packageName: string;
      version: string;
      githubOidcToken: string;
    };
    const { pkg, trustedPublisher } = await getPackageAndTrustedPublisherByName(
      ctx,
      payload.packageName,
    );
    if (!pkg) return text("Package not found", 404, rate.headers);
    if (!trustedPublisher) {
      return text("Trusted publisher config is not set for this package", 403, rate.headers);
    }

    try {
      const verified = await verifyGitHubActionsTrustedPublishJwt(payload.githubOidcToken, {
        repository: trustedPublisher.repository,
        repositoryId: trustedPublisher.repositoryId,
        repositoryOwner: trustedPublisher.repositoryOwner,
        repositoryOwnerId: trustedPublisher.repositoryOwnerId,
        workflowFilename: trustedPublisher.workflowFilename,
        ...(trustedPublisher.environment ? { environment: trustedPublisher.environment } : {}),
      });
      const { token, prefix } = generateToken();
      const tokenHash = await hashToken(token);
      const expiresAt = Date.now() + 15 * 60_000;

      await ctx.runMutation(
        internalRefs.packagePublishTokens.createInternal as never,
        {
          packageId: pkg._id,
          version: payload.version,
          prefix,
          tokenHash,
          provider: "github-actions",
          repository: verified.repository,
          repositoryId: verified.repositoryId,
          repositoryOwner: verified.repositoryOwner,
          repositoryOwnerId: verified.repositoryOwnerId,
          workflowFilename: verified.workflowFilename,
          ...(trustedPublisher.environment ? { environment: trustedPublisher.environment } : {}),
          runId: verified.runId,
          runAttempt: verified.runAttempt,
          sha: verified.sha,
          ref: verified.ref,
          ...(verified.refType ? { refType: verified.refType } : {}),
          ...(verified.actor ? { actor: verified.actor } : {}),
          ...(verified.actorId ? { actorId: verified.actorId } : {}),
          expiresAt,
        } as never,
      );
      await ctx.runMutation(
        internalRefs.packages.insertAuditLogInternal as never,
        {
          actorUserId: pkg.ownerUserId,
          action: "package.publish_token.mint",
          targetType: "package",
          targetId: String(pkg._id),
          metadata: {
            version: payload.version,
            repository: verified.repository,
            workflowFilename: verified.workflowFilename,
            ...(verified.environment ? { environment: verified.environment } : {}),
            runId: verified.runId,
            runAttempt: verified.runAttempt,
            sha: verified.sha,
            ref: verified.ref,
            decision: "allowed",
          },
        } as never,
      );
      return json({ token, expiresAt }, 200, rate.headers);
    } catch (error) {
      await ctx.runMutation(
        internalRefs.packages.insertAuditLogInternal as never,
        {
          actorUserId: pkg.ownerUserId,
          action: "package.publish_token.mint_rejected",
          targetType: "package",
          targetId: String(pkg._id),
          metadata: {
            version: payload.version,
            repository: trustedPublisher.repository,
            workflowFilename: trustedPublisher.workflowFilename,
            ...(trustedPublisher.environment ? { environment: trustedPublisher.environment } : {}),
            decision: "rejected",
            reason: error instanceof Error ? error.message : "Token verification failed",
          },
        } as never,
      );
      throw error;
    }
  } catch (error) {
    return text(error instanceof Error ? error.message : "Token mint failed", 400, rate.headers);
  }
}

export async function packagesPostRouterV1Handler(ctx: ActionCtx, request: Request) {
  const segments = getPathSegments(request, "/api/v1/packages/");
  if (segments[1] !== "trusted-publisher" || segments.length !== 2) {
    return text("Not found", 404);
  }
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;
  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;

  try {
    const body = parseArk(
      PackageTrustedPublisherUpsertRequestSchema,
      await request.json(),
      "Trusted publisher payload",
    ) as {
      repository: string;
      workflowFilename: string;
      environment?: string;
    };
    const repositoryIdentity = await fetchGitHubRepositoryIdentity(body.repository);
    const trustedPublisher = await runMutationRef<PackageTrustedPublisherLike | null>(
      ctx,
      internalRefs.packages.setTrustedPublisherForUserInternal,
      {
        actorUserId: auth.userId,
        packageName: segments[0]!,
        repository: repositoryIdentity.repository,
        repositoryId: repositoryIdentity.repositoryId,
        repositoryOwner: repositoryIdentity.repositoryOwner,
        repositoryOwnerId: repositoryIdentity.repositoryOwnerId,
        workflowFilename: body.workflowFilename,
        ...(body.environment ? { environment: body.environment } : {}),
      },
    );
    return json(
      { trustedPublisher: toPublicTrustedPublisher(trustedPublisher) },
      200,
      rate.headers,
    );
  } catch (error) {
    return text(
      error instanceof Error ? error.message : "Trusted publisher update failed",
      400,
      rate.headers,
    );
  }
}

export async function packagesDeleteRouterV1Handler(ctx: ActionCtx, request: Request) {
  const segments = getPathSegments(request, "/api/v1/packages/");
  if (segments[1] !== "trusted-publisher" || segments.length !== 2) {
    return text("Not found", 404);
  }
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;
  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;

  try {
    await runMutationRef(ctx, internalRefs.packages.deleteTrustedPublisherForUserInternal, {
      actorUserId: auth.userId,
      packageName: segments[0]!,
    });
    return json({ ok: true }, 200, rate.headers);
  } catch (error) {
    return text(
      error instanceof Error ? error.message : "Trusted publisher delete failed",
      400,
      rate.headers,
    );
  }
}

async function getReleaseForRequest(
  ctx: ActionCtx,
  pkg: Pick<PublicPackageDocLike, "_id" | "tags" | "latestReleaseId">,
  request: Request,
): Promise<ReleaseLike | null> {
  const url = new URL(request.url);
  const versionParam = url.searchParams.get("version")?.trim();
  const tagParam = url.searchParams.get("tag")?.trim();

  if (versionParam) {
    return toVisibleRelease(
      await runQueryRef<ReleaseLike | null>(
        ctx,
        internalRefs.packages.getReleaseByPackageAndVersionInternal,
        {
          packageId: pkg._id,
          version: versionParam,
        },
      ),
    );
  }
  if (tagParam) {
    const releaseId = pkg.tags[tagParam];
    if (!releaseId) return null;
    return toVisibleRelease(
      await runQueryRef<ReleaseLike | null>(ctx, internalRefs.packages.getReleaseByIdInternal, {
        releaseId,
      }),
    );
  }
  if (!pkg.latestReleaseId) return null;
  return toVisibleRelease(
    await runQueryRef<ReleaseLike | null>(ctx, internalRefs.packages.getReleaseByIdInternal, {
      releaseId: pkg.latestReleaseId,
    }),
  );
}

function isReadmeVariantPath(path: string) {
  const normalized = path.trim().toLowerCase();
  return (
    normalized === "readme.md" || normalized === "readme.mdx" || normalized === "readme.markdown"
  );
}

function resolveSkillFilePath(version: SkillVersionLike, requestedPath: string) {
  const normalized = requestedPath.trim();
  const lower = normalized.toLowerCase();
  if (isReadmeVariantPath(normalized)) {
    return (
      version.files.find((file) => {
        const fileLower = file.path.toLowerCase();
        return fileLower === "skill.md" || fileLower === "skills.md";
      }) ?? null
    );
  }
  return (
    version.files.find((file) => file.path === normalized) ??
    version.files.find((file) => file.path.toLowerCase() === lower) ??
    null
  );
}

function resolvePackageFilePath(release: ReleaseLike, requestedPath: string) {
  const normalized = requestedPath.trim();
  const lower = normalized.toLowerCase();
  if (isReadmeVariantPath(normalized)) {
    return (
      release.files.find((file) => isReadmeVariantPath(file.path)) ??
      release.files.find((file) => file.path.toLowerCase() === lower) ??
      null
    );
  }
  return (
    release.files.find((file) => file.path === normalized) ??
    release.files.find((file) => file.path.toLowerCase() === lower) ??
    null
  );
}

async function getSkillDetailForRequest(ctx: ActionCtx, slug: string) {
  return (await runQueryRef(ctx, apiRefs.skills.getBySlug, { slug })) as {
    skill: SkillPackageDocLike | null;
    latestVersion: SkillVersionLike | null;
    owner: { handle?: string; displayName?: string; image?: string } | null;
  } | null;
}

async function getSkillVersionForRequest(
  ctx: ActionCtx,
  skill: Pick<SkillPackageDocLike, "_id" | "latestVersionId" | "tags">,
  request: Request,
) {
  const url = new URL(request.url);
  const versionParam = url.searchParams.get("version")?.trim();
  const tagParam = url.searchParams.get("tag")?.trim();

  if (versionParam) {
    return (await runQueryRef(ctx, internalRefs.skills.getVersionBySkillAndVersionInternal, {
      skillId: skill._id,
      version: versionParam,
    })) as SkillVersionLike | null;
  }
  if (tagParam) {
    const versionId = skill.tags[tagParam];
    if (!versionId) return null;
    return (await runQueryRef(ctx, internalRefs.skills.getVersionByIdInternal, {
      versionId,
    })) as SkillVersionLike | null;
  }
  const latestVersionId = skill.latestVersionId ?? skill.tags.latest;
  if (!latestVersionId) return null;
  return (await runQueryRef(ctx, internalRefs.skills.getVersionByIdInternal, {
    versionId: latestVersionId,
  })) as SkillVersionLike | null;
}

async function searchPackages(
  ctx: ActionCtx,
  request: Request,
  options?: { includeSkills?: boolean },
) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const url = new URL(request.url);
  const viewerUserId = await getOptionalViewerUserIdForRequest(ctx, request);
  const queryText = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.max(1, Math.min(toOptionalNumber(url.searchParams.get("limit")) ?? 20, 100));
  const familyRaw = url.searchParams.get("family");
  const channelRaw = url.searchParams.get("channel");
  const isOfficialRaw = url.searchParams.get("isOfficial");
  const executesCodeRaw = url.searchParams.get("executesCode");
  const capabilityTag = url.searchParams.get("capabilityTag")?.trim() || undefined;
  const family =
    familyRaw === "skill" || familyRaw === "code-plugin" || familyRaw === "bundle-plugin"
      ? familyRaw
      : undefined;
  const includeSkills = options?.includeSkills ?? family === undefined;
  const channel =
    channelRaw === "official" || channelRaw === "community" || channelRaw === "private"
      ? channelRaw
      : undefined;
  const isOfficial =
    isOfficialRaw === "true" ? true : isOfficialRaw === "false" ? false : undefined;
  const executesCode =
    executesCodeRaw === "true" ? true : executesCodeRaw === "false" ? false : undefined;

  let results: CatalogSearchEntry[];
  if (family === "skill") {
    results = await runQueryRef<CatalogSearchEntry[]>(
      ctx,
      apiRefs.skills.searchPackageCatalogPublic,
      {
        query: queryText,
        limit,
        channel,
        isOfficial,
        executesCode,
        capabilityTag,
      },
    );
  } else if (family || !includeSkills) {
    results = await runQueryRef<CatalogSearchEntry[]>(
      ctx,
      internalRefs.packages.searchForViewerInternal,
      {
        query: queryText,
        limit,
        family,
        channel,
        isOfficial,
        executesCode,
        capabilityTag,
        viewerUserId: viewerUserId ?? undefined,
      },
    );
  } else {
    const [packageResults, skillResults] = await Promise.all([
      runQueryRef<CatalogSearchEntry[]>(ctx, internalRefs.packages.searchForViewerInternal, {
        query: queryText,
        limit,
        channel,
        isOfficial,
        executesCode,
        capabilityTag,
        viewerUserId: viewerUserId ?? undefined,
      }),
      runQueryRef<CatalogSearchEntry[]>(ctx, apiRefs.skills.searchPackageCatalogPublic, {
        query: queryText,
        limit,
        channel,
        isOfficial,
        executesCode,
        capabilityTag,
      }),
    ]);
    const seen = new Set<string>();
    results = [...packageResults, ...skillResults]
      .filter((entry) => {
        const key = `${entry.package.family}:${entry.package.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          Number(b.package.isOfficial) - Number(a.package.isOfficial) ||
          compareCatalogItems(a.package, b.package),
      )
      .slice(0, limit);
  }
  return json({ results }, 200, rate.headers);
}

export async function packagesGetRouterV1Handler(ctx: ActionCtx, request: Request) {
  const segments = getPathSegments(request, "/api/v1/packages/");
  if (segments.length === 0) return text("Not found", 404);
  if (segments[0] === "search" && new URL(request.url).searchParams.has("q")) {
    return await searchPackages(ctx, request, { includeSkills: true });
  }

  const rateKind = segments[1] === "download" ? "download" : "read";
  const rate = await applyRateLimit(ctx, request, rateKind);
  if (!rate.ok) return rate.response;

  const packageName = segments[0] ?? "";
  const viewerUserId = await getOptionalViewerUserIdForRequest(ctx, request);
  const detail = (await runQueryRef(ctx, internalRefs.packages.getByNameForViewerInternal, {
    name: packageName,
    viewerUserId: viewerUserId ?? undefined,
  })) as {
    package: PublicPackageDocLike | null;
    latestRelease: ReleaseLike | null;
    owner: { _id: Id<"users">; handle?: string; displayName?: string; image?: string } | null;
  } | null;
  const skillDetail = detail?.package ? null : await getSkillDetailForRequest(ctx, packageName);
  if (!detail?.package && !skillDetail?.skill) return text("Package not found", 404, rate.headers);
  const packageDetail = detail?.package ? detail : null;
  const publicPackage = packageDetail?.package ?? null;
  const packageOwner = packageDetail?.owner ?? null;

  if (segments.length === 1) {
    if (skillDetail?.skill) {
      return json(
        toSkillPackageDetail(
          skillDetail.skill,
          skillDetail.latestVersion,
          skillDetail.owner,
          await resolveSkillTags(ctx, skillDetail.skill.tags),
        ),
        200,
        rate.headers,
      );
    }
    return json(
      {
        package: {
          ...publicPackage!,
          tags: await resolvePackageTags(ctx, publicPackage!.tags),
        },
        owner: packageOwner
          ? {
              handle: packageOwner.handle ?? null,
              displayName: packageOwner.displayName ?? null,
              image: packageOwner.image ?? null,
            }
          : null,
      },
      200,
      rate.headers,
    );
  }

  if (segments[1] === "trusted-publisher" && segments.length === 2) {
    if (!publicPackage) return text("Not found", 404, rate.headers);
    const trustedPublisher = await runQueryRef<PackageTrustedPublisherLike | null>(
      ctx,
      internalRefs.packages.getTrustedPublisherByPackageIdInternal,
      { packageId: publicPackage._id },
    );
    return json(
      { trustedPublisher: toPublicTrustedPublisher(trustedPublisher) },
      200,
      rate.headers,
    );
  }

  if (segments[1] === "versions" && segments.length === 2) {
    const limit = Math.max(
      1,
      Math.min(toOptionalNumber(new URL(request.url).searchParams.get("limit")) ?? 25, 100),
    );
    const cursor = new URL(request.url).searchParams.get("cursor");
    if (skillDetail?.skill) {
      const result = (await runQueryRef(ctx, apiRefs.skills.listVersionsPage, {
        skillId: skillDetail.skill._id,
        cursor: cursor ?? undefined,
        limit,
      })) as {
        items: Array<{ version: string; createdAt: number; changelog: string }>;
        nextCursor: string | null;
      };
      const tags = await resolveSkillTags(ctx, skillDetail.skill.tags);
      return json(
        {
          items: result.items.map((version) => ({
            version: version.version,
            createdAt: version.createdAt,
            changelog: version.changelog,
            distTags: skillVersionTags(tags, version.version),
          })),
          nextCursor: result.nextCursor,
        },
        200,
        rate.headers,
      );
    }
    const result = await runQueryRef<{
      page: ReleaseLike[];
      isDone: boolean;
      continueCursor: string | null;
    }>(ctx, internalRefs.packages.listVersionsForViewerInternal, {
      name: packageName,
      viewerUserId: viewerUserId ?? undefined,
      paginationOpts: { cursor, numItems: limit },
    });
    return json(
      {
        items: result.page.map((release: ReleaseLike) => ({
          version: release.version,
          createdAt: release.createdAt,
          changelog: release.changelog,
          distTags: release.distTags ?? [],
        })),
        nextCursor: result.isDone ? null : result.continueCursor,
      },
      200,
      rate.headers,
    );
  }

  if (segments[1] === "versions" && segments[2]) {
    if (skillDetail?.skill) {
      const version = (await runQueryRef(
        ctx,
        internalRefs.skills.getVersionBySkillAndVersionInternal,
        {
          skillId: skillDetail.skill._id,
          version: segments[2],
        },
      )) as SkillVersionLike | null;
      if (!version || version.softDeletedAt) return text("Version not found", 404, rate.headers);
      const tags = await resolveSkillTags(ctx, skillDetail.skill.tags);
      return json(
        {
          package: {
            name: skillDetail.skill.slug,
            displayName: skillDetail.skill.displayName,
            family: "skill",
          },
          version: {
            version: version.version,
            createdAt: version.createdAt,
            changelog: version.changelog,
            distTags: skillVersionTags(tags, version.version),
            files: version.files.map((file) => ({
              path: file.path,
              size: file.size,
              sha256: file.sha256,
              contentType: file.contentType,
            })),
            compatibility: null,
            capabilities: null,
            verification: null,
          },
        },
        200,
        rate.headers,
      );
    }
    const result = (await runQueryRef(
      ctx,
      internalRefs.packages.getVersionByNameForViewerInternal,
      {
        name: packageName,
        version: segments[2],
        viewerUserId: viewerUserId ?? undefined,
      },
    )) as { package: PublicPackageDocLike; version: ReleaseLike } | null;
    if (!result) return text("Version not found", 404, rate.headers);
    return json(
      {
        package: {
          name: result.package.name,
          displayName: result.package.displayName,
          family: result.package.family,
        },
        version: {
          version: result.version.version,
          createdAt: result.version.createdAt,
          changelog: result.version.changelog,
          distTags: result.version.distTags ?? [],
          files: result.version.files.map((file) => ({
            path: file.path,
            size: file.size,
            sha256: file.sha256,
            contentType: file.contentType,
          })),
          compatibility: result.version.compatibility ?? null,
          capabilities: result.version.capabilities ?? null,
          verification: result.version.verification ?? null,
          sha256hash: result.version.sha256hash ?? null,
          vtAnalysis: result.version.vtAnalysis ?? null,
          llmAnalysis: result.version.llmAnalysis ?? null,
          staticScan: result.version.staticScan ?? null,
        },
      },
      200,
      rate.headers,
    );
  }

  if (segments[1] === "file") {
    const path = new URL(request.url).searchParams.get("path")?.trim();
    if (!path) return text("Missing path", 400, rate.headers);
    if (skillDetail?.skill) {
      const version = await getSkillVersionForRequest(ctx, skillDetail.skill, request);
      if (!version || version.softDeletedAt) return text("Version not found", 404, rate.headers);
      const file = resolveSkillFilePath(version, path);
      if (!file) return text("File not found", 404, rate.headers);
      if (!("storageId" in file) || !file.storageId)
        return text("File not found", 404, rate.headers);
      if (!isTextFile(file.path, file.contentType)) {
        return text("Binary files are not served inline", 415, rate.headers);
      }
      if (file.size > MAX_RAW_FILE_BYTES) return text("File too large", 413, rate.headers);
      const blob = await ctx.storage.get(file.storageId);
      if (!blob) return text("File not found", 404, rate.headers);
      return safeTextFileResponse({
        textContent: await blob.text(),
        path: file.path,
        contentType: file.contentType,
        sha256: file.sha256,
        size: file.size,
        headers: rate.headers,
      });
    }
    const release = await getReleaseForRequest(ctx, publicPackage!, request);
    if (!release) return text("Version not found", 404, rate.headers);
    const securityBlock = getReleaseSecurityBlock(release);
    if (securityBlock) return text(securityBlock.message, securityBlock.status, rate.headers);
    const file = resolvePackageFilePath(release, path);
    if (!file) return text("File not found", 404, rate.headers);
    if (!isTextFile(file.path, file.contentType)) {
      return text("Binary files are not served inline", 415, rate.headers);
    }
    if (file.size > MAX_RAW_FILE_BYTES) return text("File too large", 413, rate.headers);
    const blob = await ctx.storage.get(file.storageId);
    if (!blob) return text("File not found", 404, rate.headers);
    const textContent = await blob.text();
    return safeTextFileResponse({
      textContent,
      path: file.path,
      contentType: file.contentType,
      sha256: file.sha256,
      size: file.size,
      headers: rate.headers,
    });
  }

  if (segments[1] === "download") {
    if (skillDetail?.skill) {
      const url = new URL("/api/v1/download", request.url);
      url.searchParams.set("slug", skillDetail.skill.slug);
      const requestUrl = new URL(request.url);
      const version = requestUrl.searchParams.get("version")?.trim();
      const tag = requestUrl.searchParams.get("tag")?.trim();
      if (version) url.searchParams.set("version", version);
      if (tag) url.searchParams.set("tag", tag);
      return new Response(null, {
        status: 307,
        headers: mergeHeaders(rate.headers, { Location: url.toString() }, corsHeaders()),
      });
    }
    const release = await getReleaseForRequest(ctx, publicPackage!, request);
    if (!release) return text("Version not found", 404, rate.headers);
    const securityBlock = getReleaseSecurityBlock(release);
    if (securityBlock) return text(securityBlock.message, securityBlock.status, rate.headers);
    const entries: Array<{ path: string; bytes: Uint8Array }> = [];
    for (const file of release.files) {
      const blob = await ctx.storage.get(file.storageId);
      if (!blob) return text(`Missing stored file: ${file.path}`, 500, rate.headers);
      entries.push({
        path: file.path,
        bytes: new Uint8Array(await blob.arrayBuffer()),
      });
    }
    const zip = buildDeterministicPackageZip(entries);
    return new Response(new Blob([zip], { type: "application/zip" }), {
      status: 200,
      headers: mergeHeaders(
        rate.headers,
        {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${publicPackage!.name.replaceAll("/", "-")}-${release.version}.zip"`,
        },
        corsHeaders(),
      ),
    });
  }

  return text("Not found", 404, rate.headers);
}

export async function pluginsGetRouterV1Handler(ctx: ActionCtx, request: Request) {
  const segments = getPathSegments(request, "/api/v1/plugins/");
  if (segments.length === 0) return text("Not found", 404);
  if (segments[0] === "search" && new URL(request.url).searchParams.has("q")) {
    return await searchPackages(ctx, request, { includeSkills: false });
  }
  return text("Not found", 404);
}

type PublicPackageDocLike = {
  _id: Id<"packages">;
  name: string;
  displayName: string;
  family: "skill" | "code-plugin" | "bundle-plugin";
  tags: Record<string, Id<"packageReleases">>;
  latestReleaseId?: Id<"packageReleases">;
  channel: "official" | "community" | "private";
  isOfficial: boolean;
  runtimeId?: string;
  summary?: string;
  latestVersion?: string | null;
  compatibility?: Doc<"packages">["compatibility"];
  capabilities?: Doc<"packages">["capabilities"];
  verification?: Doc<"packages">["verification"];
  stats?: { downloads: number; installs: number; stars: number; versions: number };
  createdAt: number;
  updatedAt: number;
};
