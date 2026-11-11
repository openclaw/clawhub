import { createFileRoute, notFound } from "@tanstack/react-router";
import { buildPublisherMeta, buildSocialMetaHead } from "../lib/og";
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
      image: publisher.image,
      kind: publisher.kind,
      official: publisher.official ?? null,
      affiliations: publisher.affiliations ?? null,
      downloads: publisher.stats.downloads,
    });
    return buildSocialMetaHead(meta);
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
