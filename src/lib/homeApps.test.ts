import { describe, expect, it } from "vitest";
import {
  HOME_PLUGIN_SHORTCUTS,
  HOME_SKILL_APPS,
  homePluginShortcutIcon,
  homeSkillAppIcon,
} from "./homeApps";

describe("home app icons", () => {
  it("does not use favicon scraping or the Simple Icons placeholder for home cards", () => {
    const icons = [
      ...HOME_SKILL_APPS.map((app) => [app.id, homeSkillAppIcon(app)] as const),
      ...HOME_PLUGIN_SHORTCUTS.map(
        (shortcut) => [shortcut.id, homePluginShortcutIcon(shortcut)] as const,
      ),
    ];

    for (const [id, icon] of icons) {
      expect(icon.src, id).not.toContain("google.com/s2/favicons");

      if (icon.kind === "simple") {
        expect(icon.slug, id).not.toBe("simpleicons");
        expect(icon.src, id).toMatch(
          /^https:\/\/cdn\.jsdelivr\.net\/npm\/simple-icons@latest\/icons\/.+\.svg$/,
        );
      } else {
        expect(icon.src, id).toMatch(/^\/(?:app-icons\/.+\.svg|logo-transparent\.png)$/);
      }
    }
  });

  it("uses the app id as the Simple Icons slug unless the card declares an override", () => {
    const iconSources = [
      ...HOME_SKILL_APPS.map((app) => [app.id, app.simpleIconSlug, homeSkillAppIcon(app)] as const),
      ...HOME_PLUGIN_SHORTCUTS.map(
        (shortcut) =>
          [shortcut.id, shortcut.simpleIconSlug, homePluginShortcutIcon(shortcut)] as const,
      ),
    ];

    for (const [id, simpleIconSlug, icon] of iconSources) {
      if (icon.kind === "image") continue;

      expect(icon.slug, id).toBe(simpleIconSlug ?? id);
    }
  });

  it("uses local SVGs for brands missing exact Simple Icons entries", () => {
    const iconById = new Map(
      HOME_PLUGIN_SHORTCUTS.map((shortcut) => [shortcut.id, homePluginShortcutIcon(shortcut)]),
    );

    expect(iconById.get("feishu")?.src).toBe("/app-icons/feishu.svg");
    expect(iconById.get("exa")?.src).toBe("/app-icons/exa.svg");
    expect(iconById.get("firecrawl")?.src).toBe("/app-icons/firecrawl.svg");
    expect(iconById.get("scraperapi")?.src).toBe("/app-icons/scraperapi.svg");
    expect(iconById.get("parallel")?.src).toBe("/app-icons/parallel.svg");
    expect(iconById.get("groq")?.src).toBe("/app-icons/groq.svg");
    expect(iconById.get("deepinfra")?.src).toBe("/app-icons/deepinfra.svg");
    expect(iconById.get("cerebras")?.src).toBe("/app-icons/cerebras.svg");
  });
});
