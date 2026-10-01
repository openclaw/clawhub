import { createFileRoute, redirect } from "@tanstack/react-router";
import { buildPublisherProfileHref } from "../../lib/ownerRoute";

export const Route = createFileRoute("/p/$handle")({
  beforeLoad: ({ params }) => {
    throw redirect({
      href: buildPublisherProfileHref(params.handle),
      replace: true,
    });
  },
});
