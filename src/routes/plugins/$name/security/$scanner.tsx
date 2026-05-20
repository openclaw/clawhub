import { createFileRoute, redirect } from "@tanstack/react-router";
import { buildPluginSecurityAuditHref } from "../../../../lib/pluginRoutes";

export const Route = createFileRoute("/plugins/$name/security/$scanner")({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: buildPluginSecurityAuditHref(params.name),
      statusCode: 308,
    });
  },
});
