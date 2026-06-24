import { createFileRoute, notFound } from "@tanstack/react-router";
import { buildPublisherMeta } from "../lib/og";
import { resolveTopLevelSlugRoute } from "../lib/slugRoute";
import { PublisherProfilePage } from "./user/$handle";

export const Route = createFileRoute("/$slug")({
  loader: async ({ params }) => {
    const target = await resolveTopLevelSlugRoute(params.slug);
    if (!target) throw notFound();

    return {
      publisher: target.publisher,
    };
  },
  head: ({ params, loaderData }) => {
    if (!loaderData || !("publisher" in loaderData)) return {};
    const publisher = loaderData.publisher;
    const meta = buildPublisherMeta({
      handle: publisher.handle ?? params.slug,
      displayName: publisher.displayName,
      bio: publisher.bio,
    });
    return {
      meta: [
        { title: meta.title },
        { name: "description", content: meta.description },
        { property: "og:title", content: meta.title },
        { property: "og:description", content: meta.description },
        { property: "og:url", content: meta.url },
        { property: "og:image", content: meta.image },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: meta.title },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: meta.title },
        { name: "twitter:description", content: meta.description },
        { name: "twitter:image", content: meta.image },
      ],
      links: [{ rel: "canonical", href: meta.url }],
    };
  },
  component: TopLevelPublisherProfile,
});

function TopLevelPublisherProfile() {
  const { slug } = Route.useParams();
  const { publisher } = Route.useLoaderData() as {
    publisher: NonNullable<Awaited<ReturnType<typeof resolveTopLevelSlugRoute>>> extends infer T
      ? T extends { kind: "publisher"; publisher: infer P }
        ? P
        : never
      : never;
  };

  return <PublisherProfilePage handle={publisher.handle ?? slug} loaderPublisher={publisher} />;
}
