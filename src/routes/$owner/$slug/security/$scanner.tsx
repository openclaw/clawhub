import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import {
  buildSkillSecurityAuditHref,
  isOwnerRouteHandleOrIdSegment,
} from "../../../../lib/ownerRoute";

export const Route = createFileRoute("/$owner/$slug/security/$scanner")({
  beforeLoad: ({ params }) => {
    if (!isOwnerRouteHandleOrIdSegment(params.owner)) throw notFound();
    throw redirect({
      href: buildSkillSecurityAuditHref(params.owner, params.slug),
      replace: true,
    });
  },
});
