import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { SkillDetailPage } from "../../../components/SkillDetailPage";
import { buildSkillMeta } from "../../../lib/og";
import { buildSkillSettingsHref, isOwnerRouteHandleOrIdSegment } from "../../../lib/ownerRoute";
import { fetchSkillPageData } from "../../../lib/skillPage";

export const Route = createFileRoute("/$owner/$slug/settings")({
  beforeLoad: ({ params }) => {
    if (!isOwnerRouteHandleOrIdSegment(params.owner)) {
      throw notFound();
    }
    throw redirect({
      href: buildSkillSettingsHref(params.owner, params.slug),
      replace: true,
    });
  },
});

export async function loadSkillSettingsRouteData(params: { owner: string; slug: string }) {
  const data = await fetchSkillPageData(params.slug, params.owner);
  const canonicalOwner = data.initialData?.result?.owner?.handle ?? null;
  const canonicalSlug = data.initialData?.result?.resolvedSlug ?? params.slug;

  if (canonicalOwner && (canonicalOwner !== params.owner || canonicalSlug !== params.slug)) {
    throw redirect({
      to: "/$owner/skills/$slug/settings",
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
}

export function skillSettingsRouteHead({
  params,
  loaderData,
}: {
  params: { owner: string; slug: string };
  loaderData?: {
    owner?: string | null;
    displayName?: string | null;
    summary?: string | null;
    version?: string | null;
  };
}) {
  const meta = buildSkillMeta({
    slug: params.slug,
    owner: loaderData?.owner ?? params.owner,
    displayName: loaderData?.displayName,
    summary: loaderData?.summary,
    version: loaderData?.version ?? null,
  });
  return {
    meta: [
      { title: `Settings · ${meta.title}` },
      {
        name: "description",
        content: `Owner settings for ${loaderData?.displayName ?? params.slug}.`,
      },
    ],
  };
}

export function SkillSettingsRoutePage({
  owner,
  slug,
  initialData,
}: {
  owner: string;
  slug: string;
  initialData: Awaited<ReturnType<typeof loadSkillSettingsRouteData>>["initialData"];
}) {
  return (
    <SkillDetailPage slug={slug} canonicalOwner={owner} initialData={initialData} mode="settings" />
  );
}
