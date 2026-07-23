import { createFileRoute, notFound } from "@tanstack/react-router";
import { api } from "../../../../../convex/_generated/api";
import { SkillsShCatalogDetailPage } from "../../../../components/SkillsShCatalogDetail";
import { convexHttp } from "../../../../convex/client";

export const Route = createFileRoute("/skills-sh/$owner/$repo/$slug")({
  loader: async ({ params }) => {
    const entry = await convexHttp.query(api.skillsShMirrorPublic.getByRoute, params);
    if (!entry) throw notFound();
    return entry;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.displayName ?? "Skill"} - ClawHub` },
      {
        name: "description",
        content: loaderData
          ? `${loaderData.displayName}, an upstream skills.sh listing indexed by ClawHub`
          : "An upstream skills.sh listing indexed by ClawHub",
      },
    ],
  }),
  component: SkillsShCatalogEntryPage,
});

function SkillsShCatalogEntryPage() {
  const entry = Route.useLoaderData();
  return <SkillsShCatalogDetailPage entry={entry} />;
}
