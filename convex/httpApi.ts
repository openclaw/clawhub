import {
  ApiCliSkillDeleteResponseSchema,
  ApiCliTelemetrySyncResponseSchema,
  CliPublishRequestSchema,
  CliSkillDeleteRequestSchema,
  CliTelemetrySyncRequestSchema,
  parseArk,
} from "clawhub-schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { httpAction } from "./functions";
import { requireApiTokenUser, requirePackagePublishAuth } from "./lib/apiTokenAuth";
import { corsHeaders, mergeHeaders } from "./lib/httpHeaders";
import { applyRateLimit } from "./lib/httpRateLimit";
import { parseBooleanQueryParam, resolveBooleanQueryParam } from "./lib/httpUtils";
import { publishVersionForUser } from "./skills";

type SearchSkillEntry = {
  score: number;
  skill: {
    slug?: string;
    displayName?: string;
    summary?: string | null;
    updatedAt?: number;
  } | null;
  version: { version?: string } | null;
};

type GetBySlugResult = {
  skill: {
    _id: Id<"skills">;
    slug: string;
    displayName: string;
    summary?: string;
    tags: Record<string, string>;
    stats: unknown;
    createdAt: number;
    updatedAt: number;
  } | null;
  latestVersion: { version: string; createdAt: number; changelog: string } | null;
  owner: { handle?: string; displayName?: string; image?: string } | null;
} | null;

async function searchSkillsHandler(ctx: ActionCtx, request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const limit = toOptionalNumber(url.searchParams.get("limit"));
  const approvedOnly = parseBooleanQueryParam(url.searchParams.get("approvedOnly"));
  const highlightedOnly =
    parseBooleanQueryParam(url.searchParams.get("highlightedOnly")) || approvedOnly;
  const nonSuspiciousOnly = resolveBooleanQueryParam(
    url.searchParams.get("nonSuspiciousOnly"),
    url.searchParams.get("nonSuspicious"),
  );

  if (!query) return json({ results: [] });

  const results = (await ctx.runAction(api.search.searchSkills, {
    query,
    limit,
    highlightedOnly: highlightedOnly || undefined,
    nonSuspiciousOnly: nonSuspiciousOnly || undefined,
  })) as SearchSkillEntry[];

  return json({
    results: results.map((result) => ({
      score: result.score,
      slug: result.skill?.slug,
      displayName: result.skill?.displayName,
      summary: result.skill?.summary ?? null,
      version: result.version?.version ?? null,
      updatedAt: result.skill?.updatedAt,
    })),
  });
}

export const searchSkillsHttp = httpAction(searchSkillsHandler);

async function getSkillHandler(ctx: ActionCtx, request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug")?.trim().toLowerCase();
  if (!slug) return text("Missing slug", 400);

  const result = (await ctx.runQuery(api.skills.getBySlug, { slug })) as GetBySlugResult;
  if (!result?.skill) return text("Skill not found", 404);

  return json({
    skill: {
      slug: result.skill.slug,
      displayName: result.skill.displayName,
      summary: result.skill.summary ?? null,
      tags: result.skill.tags,
      stats: result.skill.stats,
      createdAt: result.skill.createdAt,
      updatedAt: result.skill.updatedAt,
    },
    latestVersion: result.latestVersion
      ? {
          version: result.latestVersion.version,
          createdAt: result.latestVersion.createdAt,
          changelog: result.latestVersion.changelog,
        }
      : null,
    owner: result.owner
      ? {
          handle: result.owner.handle ?? null,
          displayName: result.owner.displayName ?? null,
          image: result.owner.image ?? null,
        }
      : null,
  });
}

export const getSkillHttp = httpAction(getSkillHandler);

async function resolveSkillVersionHandler(ctx: ActionCtx, request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug")?.trim().toLowerCase();
  const hash = url.searchParams.get("hash")?.trim().toLowerCase();
  if (!slug || !hash) return text("Missing slug or hash", 400);
  if (!/^[a-f0-9]{64}$/.test(hash)) return text("Invalid hash", 400);

  const resolved = await ctx.runQuery(api.skills.resolveVersionByHash, { slug, hash });
  if (!resolved) return text("Skill not found", 404);

  return json({ slug, match: resolved.match, latestVersion: resolved.latestVersion });
}

export const resolveSkillVersionHttp = httpAction(resolveSkillVersionHandler);

async function cliWhoamiHandler(ctx: ActionCtx, request: Request) {
  try {
    const { user } = await requireApiTokenUser(ctx, request);
    return json({
      user: {
        handle: user.handle ?? null,
        displayName: user.displayName ?? null,
        image: user.image ?? null,
      },
    });
  } catch (error) {
    return text(formatAuthFailure(error), 401);
  }
}

export const cliWhoamiHttp = httpAction(cliWhoamiHandler);

async function cliUploadUrlHandler(ctx: ActionCtx, request: Request) {
  try {
    const auth = await requirePackagePublishAuth(ctx, request);
    const upload =
      auth.kind === "user"
        ? await ctx.runMutation(internal.uploads.createPackagePublishUploadForUserInternal, {
            userId: auth.userId,
          })
        : await ctx.runMutation(internal.uploads.createPackagePublishUploadForTokenInternal, {
            publishTokenId: auth.publishToken._id,
          });
    return json(upload);
  } catch (error) {
    return text(formatAuthFailure(error), 401);
  }
}

export const cliUploadUrlHttp = httpAction(cliUploadUrlHandler);

async function cliPublishHandler(ctx: ActionCtx, request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return text("Invalid JSON", 400);
  }

  try {
    const { userId } = await requireApiTokenUser(ctx, request);
    const args = parsePublishBody(body);
    if (!hasAcceptedLegacyLicenseTerms(args.acceptLicenseTerms)) {
      return text("MIT-0 license terms must be accepted to publish skills", 400);
    }
    const result = await publishVersionForUser(ctx, userId, args);
    return json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed";
    if (message.toLowerCase().includes("unauthorized")) return text(formatAuthFailure(error), 401);
    return text(message, 400);
  }
}

function hasAcceptedLegacyLicenseTerms(acceptLicenseTerms: boolean | undefined) {
  return acceptLicenseTerms === true;
}

export const cliPublishHttp = httpAction(cliPublishHandler);

async function cliSkillDeleteHandler(ctx: ActionCtx, request: Request, deleted: boolean) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return text("Invalid JSON", 400);
  }

  try {
    const { userId } = await requireApiTokenUser(ctx, request);
    const args = parseArk(CliSkillDeleteRequestSchema, body, "Delete payload");
    await ctx.runMutation(internal.skills.setSkillSoftDeletedInternal, {
      userId,
      slug: args.slug,
      deleted,
      reason: args.reason,
    });
    const ok = parseArk(ApiCliSkillDeleteResponseSchema, { ok: true }, "Delete response");
    return json(ok);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed";
    if (message.toLowerCase().includes("unauthorized")) return text(formatAuthFailure(error), 401);
    return text(message, 400);
  }
}

export const cliSkillDeleteHttp = httpAction((ctx, request) =>
  cliSkillDeleteHandler(ctx, request, true),
);
export const cliSkillUndeleteHttp = httpAction((ctx, request) =>
  cliSkillDeleteHandler(ctx, request, false),
);

async function cliTelemetrySyncHandler(ctx: ActionCtx, request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return text("Invalid JSON", 400);
  }

  try {
    const { userId } = await requireApiTokenUser(ctx, request);
    const args = parseArk(CliTelemetrySyncRequestSchema, body, "Telemetry payload");
    await ctx.runMutation(internal.telemetry.reportCliSyncInternal, {
      userId,
      roots: args.roots.map((root) => ({
        rootId: root.rootId,
        label: root.label,
        skills: root.skills.map((skill) => ({
          slug: skill.slug,
          version: skill.version ?? undefined,
        })),
      })),
    });
    const ok = parseArk(ApiCliTelemetrySyncResponseSchema, { ok: true }, "Telemetry response");
    return json(ok);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telemetry failed";
    if (message.toLowerCase().includes("unauthorized")) return text(formatAuthFailure(error), 401);
    return text(message, 400);
  }
}

export const cliTelemetrySyncHttp = httpAction(cliTelemetrySyncHandler);

async function cliDeviceCodeHandler(ctx: ActionCtx, request: Request) {
  if (request.method !== "POST") return text("Method not allowed", 405);
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;

  const body = (await request.json().catch(() => ({}))) as {
    scope?: unknown;
    label?: unknown;
    site_url?: unknown;
  };
  const result = await ctx.runMutation(internal.cliDeviceAuth.createInternal, {
    scope: typeof body.scope === "string" ? body.scope : undefined,
    label: typeof body.label === "string" ? body.label : undefined,
    siteUrl: typeof body.site_url === "string" ? body.site_url : undefined,
  });
  return json(result, 200, rate.headers);
}

export const cliDeviceCodeHttp = httpAction(cliDeviceCodeHandler);

async function cliDeviceTokenHandler(ctx: ActionCtx, request: Request) {
  if (request.method !== "POST") return text("Method not allowed", 405);
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;

  const body = (await request.json().catch(() => null)) as {
    device_code?: unknown;
    grant_type?: unknown;
  } | null;
  const deviceCode = typeof body?.device_code === "string" ? body.device_code.trim() : "";
  const grantType = typeof body?.grant_type === "string" ? body.grant_type.trim() : "";
  if (!deviceCode) {
    return json(
      { error: "invalid_request", error_description: "device_code required" },
      400,
      rate.headers,
    );
  }
  if (grantType !== "urn:ietf:params:oauth:grant-type:device_code") {
    return json(
      { error: "unsupported_grant_type", error_description: "device_code grant required" },
      400,
      rate.headers,
    );
  }

  const result = await ctx.runMutation(internal.cliDeviceAuth.pollInternal, { deviceCode });
  if ("access_token" in result) return json(result, 200, rate.headers);
  const status = result.error === "authorization_pending" ? 428 : 400;
  return json(result, status, rate.headers);
}

export const cliDeviceTokenHttp = httpAction(cliDeviceTokenHandler);

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), {
    status,
    headers: mergeHeaders(
      {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      headers,
      corsHeaders(),
    ),
  });
}

function text(value: string, status: number, headers?: HeadersInit) {
  return new Response(value, {
    status,
    headers: mergeHeaders(
      {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
      headers,
      corsHeaders(),
    ),
  });
}

function formatAuthFailure(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message || /^unauthorized$/i.test(message)) return "Unauthorized";
  return message.replace(/^ConvexError:\s*/i, "").trim() || "Unauthorized";
}

function toOptionalNumber(value: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePublishBody(body: unknown) {
  const parsed = parseArk(CliPublishRequestSchema, body, "Publish payload");
  if (parsed.files.length === 0) throw new Error("files required");
  const tags = parsed.tags && parsed.tags.length > 0 ? parsed.tags : undefined;
  return {
    slug: parsed.slug,
    displayName: parsed.displayName,
    version: parsed.version,
    changelog: parsed.changelog,
    acceptLicenseTerms: parsed.acceptLicenseTerms,
    tags,
    source: parsed.source ?? undefined,
    forkOf: parsed.forkOf
      ? {
          slug: parsed.forkOf.slug,
          version: parsed.forkOf.version ?? undefined,
        }
      : undefined,
    files: parsed.files.map((file) => ({
      ...file,
      storageId: file.storageId as Id<"_storage">,
    })),
  };
}

export const __test = {
  parsePublishBody,
  toOptionalNumber,
};

export const __handlers = {
  searchSkillsHandler,
  getSkillHandler,
  resolveSkillVersionHandler,
  cliWhoamiHandler,
  cliUploadUrlHandler,
  cliPublishHandler,
  cliSkillDeleteHandler,
  cliTelemetrySyncHandler,
  cliDeviceCodeHandler,
  cliDeviceTokenHandler,
};
