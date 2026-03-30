import { createFileRoute, redirect } from "@tanstack/react-router";
import { SkillDetailPage } from "../../components/SkillDetailPage";
import { buildSkillMeta } from "../../lib/og";
import { fetchSkillPageData } from "../../lib/skillPage";

export const Route = createFileRoute("/$owner/$slug")({
  loader: async ({ params }) => {
    const data = await fetchSkillPageData(params.slug);
    const canonicalOwner = data.initialData?.result?.owner?.handle ?? null;
    const canonicalSlug = data.initialData?.result?.resolvedSlug ?? params.slug;

    if (canonicalOwner && (canonicalOwner !== params.owner || canonicalSlug !== params.slug)) {
      throw redirect({
        to: "/$owner/$slug",
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
      links: [
        {
          rel: "canonical",
          href: meta.url,
        },
      ],
      meta: [
        { title: meta.title },
        { name: "description", content: meta.description },
        { property: "og:title", content: meta.title },
        { property: "og:description", content: meta.description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: meta.url },
        { property: "og:image", content: meta.image },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: meta.title },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: meta.title },
        { name: "twitter:description", content: meta.description },
        { name: "twitter:image", content: meta.image },
        { name: "twitter:image:alt", content: meta.title },
      ],
    };
  },
  component: OwnerSkill,
});

function OwnerSkill() {
  const { owner, slug } = Route.useParams();
  const { initialData } = Route.useLoaderData();
  return <SkillDetailPage slug={slug} canonicalOwner={owner} initialData={initialData} />;
}
