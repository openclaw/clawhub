import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  loadSkillSettingsRouteData,
  SkillSettingsRoutePage,
  skillSettingsRouteHead,
} from "../../../$owner/$slug/settings";
import { isOwnerRouteHandleOrIdSegment } from "../../../../lib/ownerRoute";

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
