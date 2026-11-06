import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { SkillDetailPage } from "../../../components/SkillDetailPage";
import { buildSkillSettingsHref, isOwnerRouteHandleOrIdSegment } from "../../../lib/ownerRoute";
import {
  buildSkillRouteMeta,
  createSkillRouteLoader,
  type SkillRouteHeadArgs,
} from "../../../lib/skillRoute";

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

export const loadSkillSettingsRouteData = createSkillRouteLoader("/$owner/skills/$slug/settings");

export function skillSettingsRouteHead({ params, loaderData }: SkillRouteHeadArgs) {
  const meta = buildSkillRouteMeta({ params, loaderData });
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
