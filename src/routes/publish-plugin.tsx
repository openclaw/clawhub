import { createFileRoute } from "@tanstack/react-router";
import { createPluginPublishRedirectOptions } from "../lib/publishRouteOptions";

export const Route = createFileRoute("/publish-plugin")(createPluginPublishRedirectOptions());
