import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import {
  loadPluginSecurityAudit,
  PluginSecurityAuditPage,
  pluginSecurityAuditHead,
  type PluginSecurityAuditLoaderData,
} from "../../$name/security-audit";
import {
  buildPluginSecurityAuditHref,
  packageNameFromScopedRoute,
} from "../../../../lib/pluginRoutes";

function packageNameFromParams(params: { scope: string; name: string }) {
  const packageName = packageNameFromScopedRoute(params.scope, params.name);
  if (!packageName) throw notFound();
  return packageName;
}

export const Route = createFileRoute("/plugins/$scope/$name/security-audit")({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: buildPluginSecurityAuditHref(packageNameFromParams(params)),
      statusCode: 308,
    });
  },
  loader: async ({ params }) => loadPluginSecurityAudit(packageNameFromParams(params)),
  head: ({ params, loaderData }) =>
    pluginSecurityAuditHead(packageNameFromParams(params), loaderData),
  component: ScopedPluginSecurityAuditRoute,
});

function ScopedPluginSecurityAuditRoute() {
  const params = Route.useParams();
  return (
    <PluginSecurityAuditPage
      name={packageNameFromParams(params)}
      loaderData={Route.useLoaderData() as PluginSecurityAuditLoaderData}
    />
  );
}
