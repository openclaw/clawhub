import { redirect } from "@tanstack/react-router";
import { buildSkillMeta } from "./og";
import { fetchSkillPageData } from "./skillPage";

export type SkillRouteHeadArgs = {
  params: { owner: string; slug: string };
  loaderData?: {
    owner?: string | null;
    displayName?: string | null;
    summary?: string | null;
    version?: string | null;
  };
};

type SkillRouteTarget =
  | "/$owner/skills/$slug"
  | "/$owner/skills/$slug/settings"
  | "/$owner/skills/$slug/security-audit";

export function createSkillRouteLoader(to: SkillRouteTarget) {
  return async function (params: { owner: string; slug: string }) {
    const data = await fetchSkillPageData(params.slug, params.owner);
    const canonicalOwner = data.initialData?.result?.owner?.handle ?? null;
    const canonicalSlug = data.initialData?.result?.resolvedSlug ?? params.slug;

    if (canonicalOwner && (canonicalOwner !== params.owner || canonicalSlug !== params.slug)) {
      throw redirect({
        to: to,
        params: { owner: canonicalOwner, slug: canonicalSlug },
        replace: true,
      });
    }

    return {
      owner: data?.owner ?? params.owner,
      displayName: data?.displayName ?? null,
      summary: data?.summary ?? null,
      version: data?.version ?? null,
      initialData: data.initialData,
    };
  };
}

export function buildSkillRouteMeta({ params, loaderData }: SkillRouteHeadArgs) {
  return buildSkillMeta({
    slug: params.slug,
    owner: loaderData?.owner ?? params.owner,
    displayName: loaderData?.displayName,
    summary: loaderData?.summary,
    version: loaderData?.version ?? null,
  });
}
