import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/packages/")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/plugins", search });
  },
});
