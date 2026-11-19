import { createFileRoute, notFound } from "@tanstack/react-router";
import { SkillDetailPage } from "../../../../components/SkillDetailPage";
import { isOwnerRouteHandleOrIdSegment } from "../../../../lib/ownerRoute";
import {
  buildSkillRouteMeta,
  createSkillRouteLoader,
  type SkillRouteHeadArgs,
} from "../../../../lib/skillRoute";

const loadSkillSettingsRouteData = createSkillRouteLoader("/$owner/skills/$slug/settings");

function skillSettingsRouteHead({ params, loaderData }: SkillRouteHeadArgs) {
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

function SkillSettingsRoutePage({
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

export const Route = createFileRoute("/$owner/skills/$slug/settings")({
  beforeLoad: ({ params }) => {
    if (!isOwnerRouteHandleOrIdSegment(params.owner)) throw notFound();
  },
  loader: async ({ params }) => loadSkillSettingsRouteData(params),
  head: ({ params, loaderData }) => skillSettingsRouteHead({ params, loaderData }),
  component: SkillSettingsRoute,
});

function SkillSettingsRoute() {
  const { owner, slug } = Route.useParams();
  const { initialData } = Route.useLoaderData();

  return <SkillSettingsRoutePage owner={owner} slug={slug} initialData={initialData} />;
}
