import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/packages/new")({
  beforeLoad: () => {
    throw redirect({
      to: "/plugins/publish",
      search: {
        ownerHandle: undefined,
        name: undefined,
        displayName: undefined,
        family: undefined,
        nextVersion: undefined,
        sourceRepo: undefined,
      },
    });
  },
});
