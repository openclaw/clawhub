import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import {
  buildSkillDetailHref,
  isOwnerRouteHandleOrIdSegment,
  isOwnerRouteScopeSegment,
} from "../../lib/ownerRoute";
import { parsePostPublishSearch } from "../../lib/postPublishSearch";
import { resolveOpenClawPluginSlug } from "../../lib/slugRoute";

export const Route = createFileRoute("/$owner/$slug")({
  validateSearch: parsePostPublishSearch,
  beforeLoad: ({ params }) => {
    if (!isOwnerRouteHandleOrIdSegment(params.owner) && !isOwnerRouteScopeSegment(params.owner)) {
      throw notFound();
    }
  },
  loader: async ({ params }) => {
    const pluginTarget = await resolveOpenClawPluginSlug(params.slug, params.owner);
    if (pluginTarget) {
      throw redirect({
        href: pluginTarget.href,
        replace: true,
      });
    }

    if (params.owner.startsWith("@")) throw notFound();

    throw redirect({
      href: buildSkillDetailHref(params.owner, params.slug),
      replace: true,
    });
  },
});
