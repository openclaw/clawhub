import { createFileRoute, notFound } from "@tanstack/react-router";
import { PluginSettingsPage } from "../../$name/settings";
import { packageNameFromScopedRoute } from "../../../../lib/pluginRoutes";

function packageNameFromParams(params: { scope: string; name: string }) {
  const packageName = packageNameFromScopedRoute(params.scope, params.name);
  if (!packageName) throw notFound();
  return packageName;
}

export const Route = createFileRoute("/plugins/$scope/$name/settings")({
  component: ScopedPluginSettingsRoute,
});

function ScopedPluginSettingsRoute() {
  return <PluginSettingsPage name={packageNameFromParams(Route.useParams())} />;
}
