import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import {
  buildPluginSecurityAuditHref,
  packageNameFromScopedRoute,
} from "../../../../../lib/pluginRoutes";

function packageNameFromParams(params: { scope: string; name: string }) {
  const packageName = packageNameFromScopedRoute(params.scope, params.name);
  if (!packageName) throw notFound();
  return packageName;
}

export const Route = createFileRoute("/plugins/$scope/$name/security/$scanner")({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: buildPluginSecurityAuditHref(packageNameFromParams(params)),
      statusCode: 308,
    });
  },
});
