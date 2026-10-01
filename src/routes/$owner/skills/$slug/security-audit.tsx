import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  loadSkillSecurityAuditRouteData,
  SkillSecurityAuditRoutePage,
  skillSecurityAuditRouteHead,
} from "../../../$owner/$slug/security-audit";
import { isOwnerRouteHandleOrIdSegment } from "../../../../lib/ownerRoute";

export const Route = createFileRoute("/$owner/skills/$slug/security-audit")({
  beforeLoad: ({ params }) => {
    if (!isOwnerRouteHandleOrIdSegment(params.owner)) throw notFound();
  },
  loader: async ({ params }) => loadSkillSecurityAuditRouteData(params),
  head: ({ params, loaderData }) => skillSecurityAuditRouteHead({ params, loaderData }),
  component: SkillSecurityAuditRoute,
});

function SkillSecurityAuditRoute() {
  const { owner, slug } = Route.useParams();
  const { initialData } = Route.useLoaderData();

  return <SkillSecurityAuditRoutePage owner={owner} slug={slug} initialData={initialData} />;
}
