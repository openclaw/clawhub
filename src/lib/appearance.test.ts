import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAppearancePage,
  fetchAppearanceTheme,
  parseAppearanceSearch,
  themeDetailHref,
} from "./appearance";
import { fetchPluginCatalog } from "./packageApi";
vi.mock("./packageApi", () => ({ fetchPluginCatalog: vi.fn() }));
vi.mock("./publicApiUrl", () => ({
  publicApiUrl: (path: string) => new URL(path, "https://registry.example"),
}));
const signal = new AbortController().signal;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(fetchPluginCatalog).mockReset();
});
describe("Appearance registry boundaries", () => {
  it("normalizes only the view and bounded query, never accepting a foreign cursor", () => {
    expect(
      parseAppearanceSearch({ view: "packs", q: "  night  ", cursor: "plugin-cursor" }),
    ).toEqual({ view: "packs", q: "night" });
    expect(parseAppearanceSearch({ view: "plugins", q: 5 })).toEqual({
      view: undefined,
      q: undefined,
    });
    expect(parseAppearanceSearch({ q: "x".repeat(300) }).q).toHaveLength(200);
  });
  it("sends theme search and its cursor only to the theme namespace", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: "theme-next" })));
    expect(await fetchAppearancePage("themes", "blue", "theme-first", signal)).toEqual({
      kind: "themes",
      items: [],
      nextCursor: "theme-next",
    });
    const url = fetch.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/api/v1/themes");
    expect(url.searchParams.get("q")).toBe("blue");
    expect(url.searchParams.get("cursor")).toBe("theme-first");
    expect(fetchPluginCatalog).not.toHaveBeenCalled();
  });
  it("uses the existing anonymous plugin category API for packs, not themes", async () => {
    vi.mocked(fetchPluginCatalog).mockResolvedValue({ items: [], nextCursor: "pack-next" });
    expect(await fetchAppearancePage("packs", "hat", "pack-first", signal)).toEqual({
      kind: "packs",
      items: [],
      nextCursor: "pack-next",
    });
    expect(fetchPluginCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "hat",
        category: "lobster-packs",
        cursor: "pack-first",
        viewerMode: "anonymous",
        signal,
      }),
    );
  });
  it("pins theme details to an exact version and rejects unsafe definitions", async () => {
    expect(themeDetailHref({ id: "alice/night", version: "1.2.3" } as never)).toBe(
      "/~appearance/themes/alice/night?version=1.2.3",
    );
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          item: { definition: { name: "Unsafe", description: "No", css: "body{}" } },
        }),
      ),
    );
    await expect(fetchAppearanceTheme("alice", "night", "1.2.3", signal)).rejects.toThrow(
      /unsupported field css/,
    );
    expect((fetch.mock.calls[0][0] as URL).searchParams.get("version")).toBe("1.2.3");
  });
  it.each([404, 429, 503])("does not treat HTTP %i as an empty result", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("private backend diagnostic", { status }),
    );
    await expect(fetchAppearancePage("themes", "", null, signal)).rejects.not.toThrow(
      /private backend diagnostic/,
    );
  });
});
