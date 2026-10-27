import { normalizeThemeDefinition, type ThemeRelease, type ThemeSummary } from "clawhub-schema";
import { fetchPluginCatalog, type PackageListItem } from "./packageApi";
import { publicApiUrl } from "./publicApiUrl";

export type AppearanceView = "themes" | "packs";
export type AppearanceSearch = { view?: AppearanceView; q?: string };
export type AppearancePage =
  | { kind: "themes"; items: ThemeSummary[]; nextCursor: string | null }
  | { kind: "packs"; items: PackageListItem[]; nextCursor: string | null };

export function parseAppearanceSearch(search: Record<string, unknown>): AppearanceSearch {
  return {
    view: search.view === "packs" ? "packs" : undefined,
    q: typeof search.q === "string" ? search.q.trim().slice(0, 200) || undefined : undefined,
  };
}

export function themeDetailHref(item: ThemeSummary) {
  const [owner, slug] = item.id.split("/");
  return (
    "/~appearance/themes/" +
    encodeURIComponent(owner) +
    "/" +
    encodeURIComponent(slug) +
    "?version=" +
    encodeURIComponent(item.version)
  );
}

async function themeJson<T>(url: URL, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Theme not found or no longer available.");
    if (response.status === 429)
      throw new Error("Too many requests. Please wait a moment and retry.");
    throw new Error("The theme registry could not be reached. Please retry.");
  }
  return response.json() as Promise<T>;
}

export async function fetchAppearancePage(
  view: AppearanceView,
  query: string,
  cursor: string | null,
  signal: AbortSignal,
): Promise<AppearancePage> {
  if (view === "packs") {
    const page = await fetchPluginCatalog({
      category: "lobster-packs",
      q: query || undefined,
      cursor: cursor ?? undefined,
      limit: 24,
      signal,
      viewerMode: "anonymous",
    });
    return { kind: "packs", items: page.items, nextCursor: page.nextCursor };
  }
  const url = publicApiUrl("/api/v1/themes");
  url.searchParams.set("limit", "24");
  if (query) url.searchParams.set("q", query);
  if (cursor) url.searchParams.set("cursor", cursor);
  const page = await themeJson<{ items: ThemeSummary[]; nextCursor: string | null }>(url, signal);
  return { kind: "themes", ...page };
}

export async function fetchAppearanceTheme(
  owner: string,
  slug: string,
  version: string | undefined,
  signal: AbortSignal,
) {
  const url = publicApiUrl(
    "/api/v1/themes/" + encodeURIComponent(owner) + "/" + encodeURIComponent(slug),
  );
  if (version) url.searchParams.set("version", version);
  const { item } = await themeJson<{ item: ThemeRelease }>(url, signal);
  // Do not render unvalidated registry colors or apply a theme to the host page.
  return { ...item, definition: normalizeThemeDefinition(item.definition) };
}
