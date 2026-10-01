import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import {
  loadPluginDetail,
  PluginDetailPage,
  PluginDetailPending,
  pluginDetailHead,
  type PluginDetailLoaderData,
} from "../$name";
import {
  buildPluginDetailHref,
  buildPluginSecurityAuditHref,
  packageNameFromScopedRoute,
} from "../../../lib/pluginRoutes";

function packageNameFromParams(params: { scope: string; name: string }) {
  const packageName = packageNameFromScopedRoute(params.scope, params.name);
  if (!packageName) throw notFound();
  return packageName;
}

export const Route = createFileRoute("/plugins/$scope/$name")({
  beforeLoad: ({ location, params }) => {
    const packageName = packageNameFromParams(params);
    const legacySecurityPrefix = `/plugins/${params.scope}/${params.name}/security`;
    const href = location.pathname.startsWith(legacySecurityPrefix)
      ? buildPluginSecurityAuditHref(packageName)
      : buildPluginDetailHref(packageName);

    throw redirect({
      href,
      statusCode: 308,
    });
  },
  loader: async ({ params }) => loadPluginDetail(packageNameFromParams(params)),
  head: ({ params, loaderData }) => pluginDetailHead(packageNameFromParams(params), loaderData),
  pendingComponent: PluginDetailPending,
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
