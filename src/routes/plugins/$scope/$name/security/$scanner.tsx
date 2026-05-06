import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  loadPluginSecurity,
  parsePluginSecurityScanner,
  PluginSecurityScannerPage,
  pluginSecurityHead,
  type PluginSecurityLoaderData,
} from "../../../$name/security/$scanner";
import { packageNameFromScopedRoute } from "../../../../../lib/pluginRoutes";

function packageNameFromParams(params: { scope: string; name: string }) {
  const packageName = packageNameFromScopedRoute(params.scope, params.name);
  if (!packageName) throw notFound();
  return packageName;
}

export const Route = createFileRoute("/plugins/$scope/$name/security/$scanner")({
  beforeLoad: ({ params }) => {
    packageNameFromParams(params);
    parsePluginSecurityScanner(params.scanner);
  },
  loader: async ({ params }) => loadPluginSecurity(packageNameFromParams(params)),
  head: ({ params, loaderData }) =>
    pluginSecurityHead(packageNameFromParams(params), params.scanner, loaderData),
  component: ScopedPluginSecurityScannerRoute,
});

function ScopedPluginSecurityScannerRoute() {
  const params = Route.useParams();
  return (
    <PluginSecurityScannerPage
      name={packageNameFromParams(params)}
      scanner={params.scanner}
      loaderData={Route.useLoaderData() as PluginSecurityLoaderData}
    />
  );
}
