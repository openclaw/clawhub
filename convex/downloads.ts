import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildDownloadMetricArgs, getDownloadIdentity } from "./downloadMetrics";
import { httpAction } from "./functions";
import { ambiguousSkillSlugResponse } from "./httpApiV1/shared";
import { getOptionalActiveAuthUserIdFromAction } from "./lib/access";
import { getOptionalApiTokenUserId } from "./lib/apiTokenAuth";
import {
  buildGitHubSkillHandoffDescriptor,
  getGitHubHandoffBlock,
  isReadyGitHubHandoffTarget,
  type GitHubHandoffTarget,
} from "./lib/githubHandoff";
import { corsHeaders, mergeHeaders } from "./lib/httpHeaders";
import { applyRateLimit, getClientIp } from "./lib/httpRateLimit";
import {
  getPublicSkillFileAccessBlock,
  getPublicSkillVersionDownloadBlock,
  isSkillVersionForSkill,
} from "./lib/skillFileAccess";
import { buildDeterministicZip } from "./lib/skillZip";

const HOUR_MS = 3_600_000;
const DOWNLOAD_STAT_JITTER_MS = 60_000;

type DownloadCtx = Parameters<Parameters<typeof httpAction>[0]>[0];

export async function downloadZipHandler(ctx: DownloadCtx, request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug")?.trim().toLowerCase();
  const ownerHandle =
    (url.searchParams.get("ownerHandle") ?? url.searchParams.get("owner"))
      ?.trim()
      .replace(/^@+/, "") || undefined;
  const versionParam = url.searchParams.get("version")?.trim();
  const tagParam = url.searchParams.get("tag")?.trim();

  if (!slug) {
    return new Response("Missing slug", {
      status: 400,
      headers: corsHeaders(),
    });
  }

  const rate = await applyRateLimit(ctx, request, "download");
  if (!rate.ok) return rate.response;

  const skillResult = await ctx.runQuery(api.skills.getBySlug, {
    slug,
    ...(ownerHandle ? { ownerHandle } : {}),
  });
  if (!skillResult?.skill) {
    if (skillResult?.ambiguous) {
      return ambiguousSkillSlugResponse(
        slug,
        `/api/v1/download?slug=${encodeURIComponent(slug)}&ownerHandle=<owner>`,
        mergeHeaders(rate.headers, corsHeaders()),
      );
    }
    return new Response("Skill not found", {
      status: 404,
      headers: mergeHeaders(rate.headers, corsHeaders()),
    });
  }

  const skill = skillResult.skill;
  let version = skill.latestVersionId
    ? await ctx.runQuery(internal.skills.getVersionByIdInternal, {
        versionId: skill.latestVersionId,
      })
    : null;

  if (versionParam) {
    version = await ctx.runQuery(internal.skills.getVersionBySkillAndVersionInternal, {
      skillId: skill._id,
      version: versionParam,
    });
  } else if (tagParam) {
    const versionId = skill.tags[tagParam];
    if (versionId) {
      version = await ctx.runQuery(internal.skills.getVersionByIdInternal, { versionId });
    }
  }

  if (!version || !isSkillVersionForSkill(version, skill._id)) {
    if (!versionParam && !tagParam && skill.installKind === "github") {
      const moderationBlock = getPublicSkillFileAccessBlock(skillResult.moderationInfo);
      if (moderationBlock) {
        return new Response(moderationBlock.message, {
          status: moderationBlock.status,
          headers: mergeHeaders(rate.headers, corsHeaders()),
        });
      }
      return githubDownloadHandoffResponse(ctx, request, skill._id, rate.headers);
    }
    return new Response("Version not found", {
      status: 404,
      headers: mergeHeaders(rate.headers, corsHeaders()),
    });
  }
  if (version.softDeletedAt) {
    return new Response("Version not available", {
      status: 410,
      headers: mergeHeaders(rate.headers, corsHeaders()),
    });
  }

  const moderationBlock = getPublicSkillVersionDownloadBlock(
    skillResult.moderationInfo,
    version,
    skill.latestVersionId ?? skill.tags.latest,
  );
  if (moderationBlock) {
    return new Response(moderationBlock.message, {
      status: moderationBlock.status,
      headers: mergeHeaders(rate.headers, corsHeaders()),
    });
  }

  const entries: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const file of version.files) {
    const blob = await ctx.storage.get(file.storageId);
    if (!blob) continue;
    const buffer = new Uint8Array(await blob.arrayBuffer());
    entries.push({ path: file.path, bytes: buffer });
  }
  const zipArray = buildDeterministicZip(entries, {
    ownerId: String(skill.ownerUserId),
    slug: skill.slug,
    version: version.version,
    publishedAt: version.createdAt,
  });
  const zipBlob = new Blob([zipArray], { type: "application/zip" });

  await scheduleSkillDownloadMetric(ctx, request, skill._id);

  return new Response(zipBlob, {
    status: 200,
    headers: mergeHeaders(
      rate.headers,
      {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${slug}-${version.version}.zip"`,
        "Cache-Control": "private, max-age=60",
      },
      corsHeaders(),
    ),
  });
}

export const downloadZip = httpAction(downloadZipHandler);

export function getHourStart(timestamp: number) {
  return Math.floor(timestamp / HOUR_MS) * HOUR_MS;
}

export function getDownloadIdentityValue(request: Request, userId: string | null) {
  if (userId) return `user:${userId}`;
  const ip = getClientIp(request);
  if (!ip) return null;
  return `ip:${ip}`;
}

async function githubDownloadHandoffResponse(
  ctx: DownloadCtx,
  request: Request,
  skillId: Id<"skills">,
  rateHeaders: HeadersInit,
) {
  const target = (await ctx.runQuery(internal.skills.getGitHubDownloadTargetInternal, {
    skillId,
  })) as GitHubHandoffTarget;
  const block = getGitHubHandoffBlock(target);
  if (block) {
    return new Response(block.message, {
      status: block.status,
      headers: mergeHeaders(rateHeaders, corsHeaders()),
    });
  }
  if (!isReadyGitHubHandoffTarget(target)) {
    return new Response("GitHub-backed skill source metadata is incomplete.", {
      status: 409,
      headers: mergeHeaders(rateHeaders, corsHeaders()),
    });
  }

  await scheduleSkillDownloadMetric(ctx, request, skillId);

  return Response.json(buildGitHubSkillHandoffDescriptor(target), {
    status: 200,
    headers: mergeHeaders(
      rateHeaders,
      {
        "Cache-Control": "private, max-age=60",
      },
      corsHeaders(),
    ),
  });
}

export async function scheduleSkillDownloadMetric(
  ctx: DownloadCtx,
  request: Request,
  skillId: Id<"skills">,
) {
  try {
    const userId = await getOptionalDownloadUserId(ctx, request);
    const identity = getDownloadIdentity(request, userId ? String(userId) : null);
    if (identity) {
      await ctx.scheduler.runAfter(
        Math.floor(Math.random() * DOWNLOAD_STAT_JITTER_MS),
        internal.downloadMetrics.recordDownloadMetricInternal,
        await buildDownloadMetricArgs({
          target: { kind: "skill", id: skillId },
          identity,
          now: Date.now(),
        }),
      );
    }
  } catch {
    // Best-effort metric path; do not fail downloads.
  }
}

async function getOptionalDownloadUserId(
  ctx: DownloadCtx,
  request: Request,
): Promise<Id<"users"> | null> {
  const apiTokenUserId = await getOptionalApiTokenUserId(ctx, request);
  if (apiTokenUserId) return apiTokenUserId;
  return (await getOptionalActiveAuthUserIdFromAction(ctx)) ?? null;
}

export const __test = {
  getHourStart,
  getDownloadIdentityValue,
};
