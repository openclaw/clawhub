import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { buildSkillSettingsHref, isOwnerRouteHandleOrIdSegment } from "../../../lib/ownerRoute";

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
