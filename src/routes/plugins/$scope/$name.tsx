import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  loadPluginDetail,
  PluginDetailPage,
  pluginDetailHead,
  type PluginDetailLoaderData,
} from "../$name";
import { packageNameFromScopedRoute } from "../../../lib/pluginRoutes";

function packageNameFromParams(params: { scope: string; name: string }) {
  const packageName = packageNameFromScopedRoute(params.scope, params.name);
  if (!packageName) throw notFound();
  return packageName;
}

export const Route = createFileRoute("/plugins/$scope/$name")({
  beforeLoad: ({ params }) => {
    packageNameFromParams(params);
  },
  loader: async ({ params }) => loadPluginDetail(packageNameFromParams(params)),
  head: ({ params, loaderData }) => pluginDetailHead(packageNameFromParams(params), loaderData),
  component: ScopedPluginDetailRoute,
});

function ScopedPluginDetailRoute() {
  const packageName = packageNameFromParams(Route.useParams());
  return (
    <PluginDetailPage
      name={packageName}
      loaderData={Route.useLoaderData() as PluginDetailLoaderData}
    />
  );
}
