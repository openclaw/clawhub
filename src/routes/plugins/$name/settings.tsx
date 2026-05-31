import { createFileRoute, redirect } from "@tanstack/react-router";
import { buildPluginDetailHref } from "../../../lib/pluginRoutes";

export const Route = createFileRoute("/plugins/$name/settings")({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: buildPluginDetailHref(params.name),
      statusCode: 308,
    });
  },
});
