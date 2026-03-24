import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/upload")({
  validateSearch: (search) => ({
    updateSlug: typeof search.updateSlug === "string" ? search.updateSlug : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/publish-skill",
      search,
    });
  },
});
