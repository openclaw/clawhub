import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { resolveTopLevelSlugRoute } from "../lib/slugRoute";

export const Route = createFileRoute("/$slug")({
  loader: async ({ params }) => {
    const target = await resolveTopLevelSlugRoute(params.slug);
    if (!target) throw notFound();

    if (target.kind === "plugin") {
      throw redirect({
        href: target.href,
        replace: true,
      });
    }

    throw redirect({
      to: "/$owner/$slug",
      params: { owner: target.owner, slug: target.slug },
      replace: true,
    });
  },
});
