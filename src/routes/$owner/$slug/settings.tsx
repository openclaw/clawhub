import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { SkillDetailPage } from "../../../components/SkillDetailPage";
import { buildSkillMeta } from "../../../lib/og";
import { fetchSkillPageData } from "../../../lib/skillPage";

export const Route = createFileRoute("/$owner/$slug/settings")({
  beforeLoad: ({ params }) => {
    const isHandle = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(params.owner);
    const isOwnerId = params.owner.startsWith("users:") || params.owner.startsWith("publishers:");
    if (!isHandle && !isOwnerId) {
      throw notFound();
    }
  },
  loader: async ({ params }) => {
    const data = await fetchSkillPageData(params.slug);
    const canonicalOwner = data.initialData?.result?.owner?.handle ?? null;
    const canonicalSlug = data.initialData?.result?.resolvedSlug ?? params.slug;

    if (canonicalOwner && (canonicalOwner !== params.owner || canonicalSlug !== params.slug)) {
      throw redirect({
        to: "/$owner/$slug/settings",
        params: { owner: canonicalOwner, slug: canonicalSlug },
        replace: true,
      });
    }

    return {
      owner: data?.owner ?? params.owner,
      displayName: data?.displayName ?? null,
      summary: data?.summary ?? null,
      version: data?.version ?? null,
      initialData: data.initialData,
    };
  },
  head: ({ params, loaderData }) => {
    const meta = buildSkillMeta({
      slug: params.slug,
      owner: loaderData?.owner ?? params.owner,
      displayName: loaderData?.displayName,
      summary: loaderData?.summary,
      version: loaderData?.version ?? null,
    });
    return {
      meta: [
        { title: `Settings · ${meta.title}` },
        {
          name: "description",
          content: `Owner settings for ${loaderData?.displayName ?? params.slug}.`,
        },
      ],
    };
  },
  component: SkillSettingsRoute,
});

function SkillSettingsRoute() {
  const { owner, slug } = Route.useParams();
  const { initialData } = Route.useLoaderData();

  return (
    <SkillDetailPage slug={slug} canonicalOwner={owner} initialData={initialData} mode="settings" />
  );
}
