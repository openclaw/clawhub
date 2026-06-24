import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/publishers/")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/creators", search, replace: true });
  },
});
