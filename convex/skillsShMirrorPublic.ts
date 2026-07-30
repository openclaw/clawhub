import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { query } from "./functions";
import { getRuntimeRolloutCapabilities } from "./lib/rolloutCapabilities";
import {
  buildSkillsShCanonicalGitHubRepo,
  buildSkillsShMirrorCatalogDetail,
  type SkillsShMirrorDetail,
  type SkillsShMirrorDigest,
} from "./lib/skillsShMirrorPublic";

const internalRefs = internal as unknown as {
  githubSkillSources: { getSkillsShAliasTargetInternal: unknown };
  skillsShMirror: {
    getByExternalIdInternal: unknown;
    getDetailByExternalIdInternal: unknown;
  };
  rolloutCapabilities: { getPublicCapabilitiesInternal: unknown };
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
  args: { owner: v.string(), repo: v.string(), slug: v.string() },
  handler: getSkillsShMirrorByRoute,
});

export async function getSkillsShMirrorByRoute(
  ctx: Pick<QueryCtx, "runQuery">,
  args: { owner: string; repo: string; slug: string },
) {
  if (!getRuntimeRolloutCapabilities().skillsSh.runtimeEnabled) return null;
  const owner = normalizeRouteSegment(args.owner);
  const repo = normalizeRouteSegment(args.repo);
  const slug = normalizeRouteSegment(args.slug);
  if (!owner || !repo || !slug) return null;
  const externalId = `${owner}/${repo}/${slug}`;
  const [digest, detail] = await Promise.all([
    ctx.runQuery(
      internalRefs.skillsShMirror.getByExternalIdInternal as never,
      {
        externalId,
      } as never,
    ) as Promise<SkillsShMirrorDigest | null>,
    ctx.runQuery(
      internalRefs.skillsShMirror.getDetailByExternalIdInternal as never,
      {
        externalId,
      } as never,
    ) as Promise<SkillsShMirrorDetail | null>,
  ]);
  // A promoted native repo/path remains the canonical compatibility target even
  // after the external listing itself is no longer published.
  const canonicalRepo = digest ? buildSkillsShCanonicalGitHubRepo(digest) : null;
  const alias =
    digest?.githubPath && canonicalRepo
      ? ((await ctx.runQuery(
          internalRefs.githubSkillSources.getSkillsShAliasTargetInternal as never,
          { repo: canonicalRepo, path: digest.githubPath } as never,
        )) as { canonicalRoute: string; canonicalRef: string } | null)
      : null;
  if (alias) return { kind: "redirect" as const, ...alias };
  if (!digest) return null;
  const capabilities = (await ctx.runQuery(
    internalRefs.rolloutCapabilities.getPublicCapabilitiesInternal as never,
    {} as never,
  )) as { skillsSh: { publicCatalogEnabled: boolean } };
  if (!capabilities.skillsSh.publicCatalogEnabled) return null;
  const entry = buildSkillsShMirrorCatalogDetail({ digest, detail });
  return entry ? { kind: "external" as const, entry } : null;
}
