import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import {
  buildPluginSecurityAuditHref,
  packageNameFromPublisherPluginRoute,
} from "../../../../../lib/pluginRoutes";

export const Route = createFileRoute("/$owner/plugins/$slug/security/$scanner")({
  beforeLoad: ({ params }) => {
    const packageName = packageNameFromPublisherPluginRoute(params.owner, params.slug);
    if (!packageName) throw notFound();
    throw redirect({
      href: buildPluginSecurityAuditHref(packageName),
      statusCode: 308,
    });
  },
});
