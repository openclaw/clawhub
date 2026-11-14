import { createFileRoute } from "@tanstack/react-router";
import { createSkillPublishRedirectOptions } from "../lib/publishRouteOptions";

export const Route = createFileRoute("/upload")(createSkillPublishRedirectOptions());
