import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { GenericNotFoundPage } from "../../../components/GenericNotFoundPage";
import {
  isPublisherListingPath,
  PendingPackageListing,
} from "../../../components/PendingPackageListing";
import {
  buildPluginDetailHref,
  packageNameFromPublisherPluginRoute,
} from "../../../lib/pluginRoutes";
import { normalizePublisherHandle } from "../../../lib/templateRoutes";
import {
  loadPluginDetail,
  PluginDetailPage,
  PluginDetailPending,
  PluginNotFound,
  pluginDetailHead,
  type PluginDetailLoaderData,
} from "../../plugins/$name";

function packageNameFromParams(params: { owner: string; slug: string }) {
  const packageName = packageNameFromPublisherPluginRoute(params.owner, params.slug);
  if (!packageName) throw notFound();
  return packageName;
}

async function loadPublisherPluginDetail(params: {
  owner: string;
  slug: string;
}): Promise<PluginDetailLoaderData> {
  const scopedName = packageNameFromParams(params);
  const scopedData = await loadPluginDetail(scopedName);
  if (scopedData.detail.package || scopedData.rateLimited) return scopedData;

  // A different publisher's @openclaw/slug must not shadow this owner's unscoped plugin.
  const owner = normalizePublisherHandle(params.owner);
  const unscopedData = await loadPluginDetail(
    params.slug,
    owner === "openclaw" ? undefined : [params.slug],
  );
  if (unscopedData.rateLimited?.scope === "detail") return unscopedData;
  if (
    unscopedData.detail.package?.name &&
    normalizePublisherHandle(unscopedData.detail.owner?.handle) === owner
  ) {
    return unscopedData;
  }

  return scopedData;
}

export const Route = createFileRoute("/$owner/plugins/$slug")({
  beforeLoad: ({ params }) => {
    packageNameFromParams(params);
  },
  loader: async ({ params, location }) => {
    const data = await loadPublisherPluginDetail(params);
    // Keep the existing nested audit/scanner routes independent of the listing preview.
    const isListing = isPublisherListingPath(location.pathname);
    const family = data.detail.package?.family;
    if (
      isListing &&
      data.rateLimited?.scope !== "detail" &&
      family !== "code-plugin" &&
      family !== "bundle-plugin"
    ) {
      throw notFound({ data: "listing" });
    }
    const ownerHandle = data.detail.owner?.handle ?? params.owner;
    const packageName = data.detail.package?.name ?? packageNameFromParams(params);
    const canonicalHref = buildPluginDetailHref(packageName, { ownerHandle });

    if (canonicalHref !== buildPluginDetailHref(packageNameFromParams(params))) {
      throw redirect({
        href: canonicalHref,
        replace: true,
      });
    }

    return data;
  },
  head: ({ params, loaderData }) =>
    pluginDetailHead(loaderData?.detail.package?.name ?? packageNameFromParams(params), loaderData),
  pendingComponent: PluginDetailPending,
  notFoundComponent: PublisherPluginNotFound,
  component: PublisherPluginDetailRoute,
});

function PublisherPluginNotFound({ data }: { data?: unknown }) {
  const params = Route.useParams();
  if (data !== "listing") return <GenericNotFoundPage />;
  return (
    <PendingPackageListing
      target={{ ...params, routeKind: "plugin" }}
      notFound={<PluginNotFound />}
      loading={<PluginDetailPending />}
    />
  );
}

function PublisherPluginDetailRoute() {
  const params = Route.useParams();
  const loaderData = Route.useLoaderData() as PluginDetailLoaderData;
  const packageName = loaderData.detail.package?.name ?? packageNameFromParams(params);

  return (
    <PluginDetailPage
      name={packageName}
      loaderData={loaderData}
      pendingNotice={
        <PendingPackageListing
          target={{ ...params, routeKind: "plugin" }}
          publishedName={packageName}
        />
      }
    />
  );
}
