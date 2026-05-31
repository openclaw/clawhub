import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { packageNameFromScopedRoute, buildPluginDetailHref } from "../../../../lib/pluginRoutes";

function packageNameFromParams(params: { scope: string; name: string }) {
  const packageName = packageNameFromScopedRoute(params.scope, params.name);
  if (!packageName) throw notFound();
  return packageName;
}

export const Route = createFileRoute("/plugins/$scope/$name/settings")({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: buildPluginDetailHref(packageNameFromParams(params)),
      statusCode: 308,
    });
  },
});
