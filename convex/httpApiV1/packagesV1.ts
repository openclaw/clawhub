import { getAuthUserId } from "@convex-dev/auth/server";
import { PackagePublishRequestSchema, parseArk } from "clawhub-schema";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getOptionalApiTokenUserId } from "../lib/apiTokenAuth";
import { corsHeaders, mergeHeaders } from "../lib/httpHeaders";
import { applyRateLimit } from "../lib/httpRateLimit";
import { buildDeterministicZip } from "../lib/skillZip";
import { isMacJunkPath, isTextFile } from "../lib/skills";
import {
  MAX_RAW_FILE_BYTES,
  getPathSegments,
  json,
  requireApiTokenUserOrResponse,
  safeTextFileResponse,
  text,
  toOptionalNumber,
} from "./shared";
const apiRefs = api as unknown as {
  packages: {
    listPublicPage: unknown;
    publishPackage: unknown;
    searchPublic: unknown;
    getByName: unknown;
    listVersions: unknown;
    getVersionByName: unknown;
  };
};
const internalRefs = internal as unknown as {
  packages: {
    getReleasesByIdsInternal: unknown;
    getReleaseByPackageAndVersionInternal: unknown;
    getReleaseByIdInternal: unknown;
  };
};

async function runQueryRef<T>(ctx: ActionCtx, ref: unknown, args: unknown): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

async function runActionRef<T>(ctx: ActionCtx, ref: unknown, args: unknown): Promise<T> {
  return (await ctx.runAction(ref as never, args as never)) as T;
}

type PackageListQueryArgs = {
  family?: "skill" | "code-plugin" | "bundle-plugin";
  channel?: "official" | "community" | "private";
  isOfficial?: boolean;
  executesCode?: boolean;
  capabilityTag?: string;
  paginationOpts: { cursor: string | null; numItems: number };
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
  integritySha256?: string;
  softDeletedAt?: number;
};

function toVisibleRelease(release: ReleaseLike | null) {
  if (!release || ("softDeletedAt" in release && release.softDeletedAt !== undefined)) return null;
  return release;
}

async function resolvePackageTags(
  ctx: ActionCtx,
  tags: Record<string, Id<"packageReleases">>,
): Promise<Record<string, string>> {
  const releaseIds = Object.values(tags);
  if (releaseIds.length === 0) return {};
  const releases = await runQueryRef<ReleaseLike[]>(ctx, internalRefs.packages.getReleasesByIdsInternal, {
    releaseIds,
  });
  const byId = new Map(releases.map((release) => [release._id, release.version]));
  return Object.fromEntries(
    Object.entries(tags)
      .map(([tag, releaseId]) => [tag, byId.get(releaseId)])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function parsePackagePublishBody(body: unknown) {
  const parsed = parseArk(PackagePublishRequestSchema, body, "Package publish payload") as {
    name: string;
    displayName?: string;
    family: "skill" | "code-plugin" | "bundle-plugin";
    version: string;
    changelog: string;
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
    family: parsed.family,
    version: parsed.version,
    changelog: parsed.changelog,
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
    const buffer = new Uint8Array(await entry.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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

async function listPackages(ctx: ActionCtx, request: Request, family?: PackageListQueryArgs["family"]) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const url = new URL(request.url);
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
  const result = await runQueryRef<{
    page: unknown[];
    isDone: boolean;
    continueCursor: string | null;
  }>(ctx, apiRefs.packages.listPublicPage, {
    family: effectiveFamily,
    channel:
      channelRaw === "official" || channelRaw === "community" || channelRaw === "private"
        ? channelRaw
        : undefined,
    isOfficial:
      isOfficialRaw === "true" ? true : isOfficialRaw === "false" ? false : undefined,
    executesCode:
      executesCodeRaw === "true" ? true : executesCodeRaw === "false" ? false : undefined,
    capabilityTag,
    paginationOpts: { cursor, numItems: limit },
  } satisfies PackageListQueryArgs);
  return json(
    { items: result.page, nextCursor: result.isDone ? null : result.continueCursor },
    200,
    rate.headers,
  );
}

export async function listPackagesV1Handler(ctx: ActionCtx, request: Request) {
  return await listPackages(ctx, request);
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

  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;

  try {
    const contentType = request.headers.get("content-type") ?? "";
    const payload = contentType.includes("multipart/form-data")
      ? await parseMultipartPackagePublish(ctx, request)
      : parsePackagePublishBody(await request.json());
    const result = await runActionRef(ctx, apiRefs.packages.publishPackage, {
      userId: auth.userId,
      payload,
    });
    return json(result, 200, rate.headers);
  } catch (error) {
    return text(error instanceof Error ? error.message : "Publish failed", 400, rate.headers);
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

export async function packagesGetRouterV1Handler(ctx: ActionCtx, request: Request) {
  const segments = getPathSegments(request, "/api/v1/packages/");
  if (segments.length === 0) return text("Not found", 404);

  const rateKind = segments[1] === "file" || segments[1] === "download" ? "download" : "read";
  const rate = await applyRateLimit(ctx, request, rateKind);
  if (!rate.ok) return rate.response;

  if (segments[0] === "search" && new URL(request.url).searchParams.has("q")) {
    const url = new URL(request.url);
    const queryText = url.searchParams.get("q")?.trim() ?? "";
    const limit = Math.max(1, Math.min(toOptionalNumber(url.searchParams.get("limit")) ?? 20, 100));
    const familyRaw = url.searchParams.get("family");
    const channelRaw = url.searchParams.get("channel");
    const isOfficialRaw = url.searchParams.get("isOfficial");
    const executesCodeRaw = url.searchParams.get("executesCode");
    const capabilityTag = url.searchParams.get("capabilityTag")?.trim() || undefined;
    const results = await runQueryRef(ctx, apiRefs.packages.searchPublic, {
      query: queryText,
      limit,
      family:
        familyRaw === "skill" || familyRaw === "code-plugin" || familyRaw === "bundle-plugin"
          ? familyRaw
          : undefined,
      channel:
        channelRaw === "official" || channelRaw === "community" || channelRaw === "private"
          ? channelRaw
          : undefined,
      isOfficial:
        isOfficialRaw === "true" ? true : isOfficialRaw === "false" ? false : undefined,
      executesCode:
        executesCodeRaw === "true" ? true : executesCodeRaw === "false" ? false : undefined,
      capabilityTag,
    });
    return json({ results }, 200, rate.headers);
  }

  const packageName = segments[0] ?? "";
  const viewerUserId = (await getOptionalApiTokenUserId(ctx, request)) ?? (await getAuthUserId(ctx));
  const detail = (await runQueryRef(
    ctx,
    apiRefs.packages.getByName,
    {
      name: packageName,
      viewerUserId: viewerUserId ?? undefined,
    },
  )) as
    | {
        package: PublicPackageDocLike | null;
        latestRelease: ReleaseLike | null;
        owner: { _id: Id<"users">; handle?: string; displayName?: string; image?: string } | null;
      }
    | null;

  if (!detail?.package) return text("Package not found", 404, rate.headers);

  if (segments.length === 1) {
    return json({
      package: {
        ...detail.package,
        tags: await resolvePackageTags(ctx, detail.package.tags),
      },
      owner: detail.owner
        ? {
            handle: detail.owner.handle ?? null,
            displayName: detail.owner.displayName ?? null,
            image: detail.owner.image ?? null,
          }
        : null,
    }, 200, rate.headers);
  }

  if (segments[1] === "versions" && segments.length === 2) {
    const limit = Math.max(1, Math.min(toOptionalNumber(new URL(request.url).searchParams.get("limit")) ?? 25, 100));
    const cursor = new URL(request.url).searchParams.get("cursor");
    const result = await runQueryRef<{
      page: ReleaseLike[];
      isDone: boolean;
      continueCursor: string | null;
    }>(ctx, apiRefs.packages.listVersions, {
      name: packageName,
      viewerUserId: viewerUserId ?? undefined,
      paginationOpts: { cursor, numItems: limit },
    });
    return json({
      items: result.page.map((release: ReleaseLike) => ({
        version: release.version,
        createdAt: release.createdAt,
        changelog: release.changelog,
        distTags: release.distTags ?? [],
      })),
      nextCursor: result.isDone ? null : result.continueCursor,
    }, 200, rate.headers);
  }

  if (segments[1] === "versions" && segments[2]) {
    const result = (await runQueryRef(
      ctx,
      apiRefs.packages.getVersionByName,
      {
        name: packageName,
        version: segments[2],
        viewerUserId: viewerUserId ?? undefined,
      },
    )) as { package: PublicPackageDocLike; version: ReleaseLike } | null;
    if (!result) return text("Version not found", 404, rate.headers);
    return json({
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
      },
    }, 200, rate.headers);
  }

  if (segments[1] === "file") {
    const path = new URL(request.url).searchParams.get("path")?.trim();
    if (!path) return text("Missing path", 400, rate.headers);
    const release = await getReleaseForRequest(ctx, detail.package, request);
    if (!release) return text("Version not found", 404, rate.headers);
    const file = release.files.find((entry) => entry.path === path);
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
    const release = await getReleaseForRequest(ctx, detail.package, request);
    if (!release) return text("Version not found", 404, rate.headers);
    const entries: Array<{ path: string; bytes: Uint8Array }> = [];
    for (const file of release.files) {
      const blob = await ctx.storage.get(file.storageId);
      if (!blob) continue;
      entries.push({
        path: file.path,
        bytes: new Uint8Array(await blob.arrayBuffer()),
      });
    }
    const zip = buildDeterministicZip(entries, {
      ownerId: String(detail.owner?._id ?? ""),
      slug: detail.package.name.replaceAll("/", "-"),
      version: release.version,
      publishedAt: release.createdAt,
    });
    return new Response(new Blob([zip], { type: "application/zip" }), {
      status: 200,
      headers: mergeHeaders(
        rate.headers,
        {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${detail.package.name.replaceAll("/", "-")}-${release.version}.zip"`,
        },
        corsHeaders(),
      ),
    });
  }

  return text("Not found", 404, rate.headers);
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
  createdAt: number;
  updatedAt: number;
};
