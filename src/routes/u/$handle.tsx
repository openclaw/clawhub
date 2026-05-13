import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/u/$handle")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/user/$handle",
      params: { handle: params.handle },
      replace: true,
    });
  },
});
