import { createFileRoute, notFound } from "@tanstack/react-router";
import { buildPublisherMeta, buildSocialMetaHead } from "../lib/og";
import { resolveTopLevelSlugRoute } from "../lib/slugRoute";
import { loadPublisherProfileData, PublisherProfilePage } from "./user/$handle";

export const Route = createFileRoute("/$slug")({
  loader: async ({ params, abortController }) => {
    const target = await resolveTopLevelSlugRoute(params.slug);
    if (!target) throw notFound();

    return loadPublisherProfileData(target.publisher, abortController.signal);
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
  const { publisher, initialCatalog } = Route.useLoaderData();
  return (
    <PublisherProfilePage
      key={publisher._id}
      loaderPublisher={publisher}
      initialCatalog={initialCatalog}
    />
  );
}
