import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/publish-skill")({
  validateSearch: (search) => ({
    updateSlug: typeof search.updateSlug === "string" ? search.updateSlug : undefined,
    ownerHandle: typeof search.ownerHandle === "string" ? search.ownerHandle : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/skills/publish",
      search,
    });
  },
});
