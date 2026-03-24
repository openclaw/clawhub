import { createFileRoute } from "@tanstack/react-router";
import { SoulDetailPage } from "../../components/SoulDetailPage";
import { buildSoulMeta, fetchSoulMeta } from "../../lib/og";

export const Route = createFileRoute("/souls/$slug")({
  loader: async ({ params }) => {
    const data = await fetchSoulMeta(params.slug);
    return {
      owner: data?.owner ?? null,
      displayName: data?.displayName ?? null,
      summary: data?.summary ?? null,
      version: data?.version ?? null,
    };
  },
  head: ({ params, loaderData }) => {
    const meta = buildSoulMeta({
      slug: params.slug,
      owner: loaderData?.owner ?? null,
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
  component: SoulDetail,
});

function SoulDetail() {
  const { slug } = Route.useParams();
  return <SoulDetailPage slug={slug} />;
}
