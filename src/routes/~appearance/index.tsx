import { createFileRoute } from "@tanstack/react-router";
import { AppearanceCatalog } from "../../components/AppearanceCatalog";
import { parseAppearanceSearch } from "../../lib/appearance";

export const Route = createFileRoute("/~appearance/")({
  validateSearch: parseAppearanceSearch,
  head: () => ({
    meta: [
      { title: "Appearance · ClawHub" },
      { name: "description", content: "Discover data-only themes and Lobster Packs for OpenClaw." },
    ],
  }),
  component: AppearanceIndex,
});

function AppearanceIndex() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AppearanceCatalog search={search} onNavigate={(next) => void navigate({ search: next })} />
  );
}
