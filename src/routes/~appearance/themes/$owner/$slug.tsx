import { createFileRoute } from "@tanstack/react-router";
import { AppearanceThemeDetail } from "../../../../components/AppearanceThemeDetail";

export const Route = createFileRoute("/~appearance/themes/$owner/$slug")({
  validateSearch: (search: Record<string, unknown>): { version?: string } => ({
    version:
      typeof search.version === "string" && search.version.length <= 64
        ? search.version
        : undefined,
  }),
  head: () => ({ meta: [{ title: "Theme · ClawHub" }] }),
  component: ThemeDetail,
});
function ThemeDetail() {
  const { owner, slug } = Route.useParams();
  const { version } = Route.useSearch();
  return <AppearanceThemeDetail owner={owner} slug={slug} version={version} />;
}
