import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/packages/$name")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/plugins/$name", params });
  },
});
