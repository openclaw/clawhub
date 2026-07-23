import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { query } from "./functions";
import {
  buildSkillsShMirrorCatalogDetail,
  type SkillsShMirrorDetail,
  type SkillsShMirrorDigest,
} from "./lib/skillsShMirrorPublic";

const internalRefs = internal as unknown as {
  skillsShMirror: {
    getByExternalIdInternal: unknown;
    getDetailByExternalIdInternal: unknown;
  };
};

function normalizeRouteSegment(value: string) {
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.includes(":") ||
    normalized.includes("..")
  ) {
    return null;
  }
  return normalized;
}

export const getByRoute = query({
  args: {
    owner: v.string(),
    repo: v.string(),
    slug: v.string(),
  },
  handler: getSkillsShMirrorByRoute,
});

export async function getSkillsShMirrorByRoute(
  ctx: Pick<QueryCtx, "runQuery">,
  args: { owner: string; repo: string; slug: string },
) {
  const owner = normalizeRouteSegment(args.owner);
  const repo = normalizeRouteSegment(args.repo);
  const slug = normalizeRouteSegment(args.slug);
  if (!owner || !repo || !slug) return null;
  const externalId = `${owner}/${repo}/${slug}`;
  const [digest, detail] = await Promise.all([
    ctx.runQuery(
      internalRefs.skillsShMirror.getByExternalIdInternal as never,
      { externalId } as never,
    ) as Promise<SkillsShMirrorDigest | null>,
    ctx.runQuery(
      internalRefs.skillsShMirror.getDetailByExternalIdInternal as never,
      { externalId } as never,
    ) as Promise<SkillsShMirrorDetail | null>,
  ]);
  if (!digest) return null;
  return buildSkillsShMirrorCatalogDetail({ digest, detail });
}
