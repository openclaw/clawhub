import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import {
  buildPluginDetailHref,
  packageNameFromPublisherPluginRoute,
} from "../../../lib/pluginRoutes";
import {
  loadPluginDetail,
  PluginDetailPage,
  PluginDetailPending,
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
  if (scopedData.detail.package) return scopedData;

  const unscopedData = await loadPluginDetail(params.slug);
  if (unscopedData.detail.package?.name && unscopedData.detail.owner?.handle === params.owner) {
    return unscopedData;
  }

  return scopedData;
}

export const Route = createFileRoute("/$owner/plugins/$slug")({
  beforeLoad: ({ params }) => {
    packageNameFromParams(params);
  },
  loader: async ({ params }) => {
    const data = await loadPublisherPluginDetail(params);
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
  component: PublisherPluginDetailRoute,
});

function PublisherPluginDetailRoute() {
  const params = Route.useParams();
  const loaderData = Route.useLoaderData() as PluginDetailLoaderData;
  const packageName = loaderData.detail.package?.name ?? packageNameFromParams(params);

  return <PluginDetailPage name={packageName} loaderData={loaderData} />;
}
