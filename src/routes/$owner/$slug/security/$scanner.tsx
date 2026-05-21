import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/$owner/$slug/security/$scanner")({
  beforeLoad: ({ params }) => {
    const isHandle = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(params.owner);
    const isOwnerId = params.owner.startsWith("users:") || params.owner.startsWith("publishers:");
    if (!isHandle && !isOwnerId) throw notFound();
    throw redirect({
      to: "/$owner/$slug/security-audit",
      params: {
        owner: params.owner,
        slug: params.slug,
      },
      replace: true,
    });
  },
});
