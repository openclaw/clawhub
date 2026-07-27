import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { api } from "../../../../../convex/_generated/api";
import { SkillsShCatalogDetailPage } from "../../../../components/SkillsShCatalogDetail";
import { convexHttp } from "../../../../convex/client";

export const Route = createFileRoute("/skills-sh/$owner/$repo/$slug")({
  loader: async ({ params }) => {
    const result = await convexHttp.query(api.skillsShMirrorPublic.getByRoute, params);
    if (!result) throw notFound();
    if (result.kind === "redirect") throw redirect({ href: result.canonicalRoute });
    return result.entry;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.displayName ?? "Skill"} - ClawHub` },
      {
        name: "description",
        content: loaderData
          ? `${loaderData.displayName}, a stored upstream skills.sh listing`
          : "A stored upstream skills.sh listing",
      },
    ],
  }),
  component: SkillsShCatalogEntryPage,
});

function SkillsShCatalogEntryPage() {
  return <SkillsShCatalogDetailPage entry={Route.useLoaderData()} />;
}
