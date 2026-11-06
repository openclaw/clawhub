import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  loadSkillDetailRouteData,
  SkillDetailRoutePage,
  skillDetailRouteHead,
} from "../../$owner/$slug";
import { isOwnerRouteHandleOrIdSegment } from "../../../lib/ownerRoute";
import { parsePostPublishSearch } from "../../../lib/postPublishSearch";

export const Route = createFileRoute("/$owner/skills/$slug")({
  validateSearch: parsePostPublishSearch,
  beforeLoad: ({ params }) => {
    if (!isOwnerRouteHandleOrIdSegment(params.owner)) throw notFound();
  },
  loader: async ({ params }) => loadSkillDetailRouteData(params),
  head: ({ params, loaderData }) => skillDetailRouteHead({ params, loaderData }),
  component: OwnerSkill,
});

function OwnerSkill() {
  const { owner, slug } = Route.useParams();
  const search = Route.useSearch();
  const { initialData } = Route.useLoaderData();

  return (
    <SkillDetailRoutePage
      owner={owner}
      slug={slug}
      published={search.published}
      initialData={initialData}
    />
  );
}
