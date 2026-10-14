import { createFileRoute, Link } from "@tanstack/react-router";
import { ClawDiscovery, ClawSearch } from "../../components/ClawDiscovery";
import { clawCategoryLabel, fetchClawDiscovery } from "../../lib/clawDiscovery";
import "../../claws.css";

function searchText(value: unknown, limit: number) {
  // Native GET URLs pass through TanStack's JSON parser before validation.
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).slice(0, limit);
  }
  return value === null ? "null" : undefined;
}

export const Route = createFileRoute("/claws/")({
  validateSearch: (search: Record<string, unknown>): { q?: string; category?: string } => ({
    q: searchText(search.q, 200),
    category: searchText(search.category, 100),
  }),
  loader: async () => {
    try {
      return await fetchClawDiscovery();
    } catch {
      return null;
    }
  },
  component: ClawsBrowse,
});

function ClawsBrowse() {
  const { q, category } = Route.useSearch();
  return (
    <main className="claw-container claw-browse">
      <Link to="/" className="claw-text-link">
        ← Field guide
      </Link>
      <header>
        <span className="oc-eyebrow">The Claw collection</span>
        <h1>{category ? clawCategoryLabel(category) : "Explore Claws"}</h1>
        <p>Find a ready-made agent for the way you work.</p>
        <ClawSearch query={q} category={category} />
      </header>
      <ClawDiscovery initialData={Route.useLoaderData()} browse query={q} category={category} />
    </main>
  );
}
