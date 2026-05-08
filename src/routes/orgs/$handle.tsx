import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/orgs/$handle")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/p/$handle",
      params: { handle: params.handle },
      replace: true,
    });
  },
});
