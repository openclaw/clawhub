import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { isOwnerRouteHandleOrIdSegment } from "../../../../lib/ownerRoute";

export const Route = createFileRoute("/$owner/$slug/security/$scanner")({
  beforeLoad: ({ params }) => {
    if (!isOwnerRouteHandleOrIdSegment(params.owner)) throw notFound();
    throw redirect({
      to: "/$owner/$slug/security-audit",
      params: {
        owner: params.owner,
        slug: params.slug,
      },
      replace: true,
    });
  },
});
