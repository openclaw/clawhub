import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/users/")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/publishers", search, replace: true });
  },
});
