import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  loadSkillDetailRouteData,
  SkillDetailRoutePage,
  skillDetailRouteHead,
} from "../../$owner/$slug";
import { isOwnerRouteHandleOrIdSegment } from "../../../lib/ownerRoute";

function isPostPublishFlag(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().replace(/^"|"$/g, "") : value;
  return normalized === "1" || normalized === "true" || normalized === 1 || normalized === true;
}

export const Route = createFileRoute("/$owner/skills/$slug")({
  validateSearch: (search) => {
    const parsed: { published?: true } = {};
    if (isPostPublishFlag(search.published)) {
      parsed.published = true;
    }
    return parsed;
  },
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
