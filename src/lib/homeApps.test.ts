import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOME_PLUGIN_SHORTCUTS,
  HOME_SKILL_APPS,
  HOME_APP_IMAGE_ICON_PRELOADS,
  homePluginShortcutIcon,
  homeSkillAppIcon,
} from "./homeApps";

describe("home app icons", () => {
  const icons = [
    ...HOME_SKILL_APPS.map((app) => [app.id, homeSkillAppIcon(app)] as const),
    ...HOME_PLUGIN_SHORTCUTS.map(
      (shortcut) => [shortcut.id, homePluginShortcutIcon(shortcut)] as const,
    ),
  ];

  it("does not use favicon scraping or the Simple Icons placeholder for home cards", () => {
    for (const [id, icon] of icons) {
      expect(icon.src, id).not.toContain("google.com/s2/favicons");

      if (icon.kind === "simple") {
        expect(icon.slug, id).not.toBe("simpleicons");
        expect(icon.src, id).toMatch(
          /^https:\/\/cdn\.jsdelivr\.net\/npm\/simple-icons@latest\/icons\/.+\.svg$/,
        );
      } else {
        expect(icon.src, id).toMatch(/^\/app-icons\/.+\.svg$/);
      }
    }
  });

  it("uses pure local SVG files for image icons", () => {
    const imageIconSrcs = new Set<string>();

    for (const [id, icon] of icons) {
      if (icon.kind !== "image") continue;
      imageIconSrcs.add(icon.src);

      const iconPath = join(process.cwd(), "public", icon.src.replace(/^\//, ""));
      const svg = readFileSync(iconPath, "utf8");

      expect(svg.trimStart(), id).toMatch(/^(<\?xml[^>]*>\s*)?<svg\b/);
      expect(svg, id).not.toMatch(/<image\b|data:image|base64/i);
      expect(svg, id).not.toMatch(/<text\b|font-family|clip0_6630_17005|translate\(0 310\.84\)/i);

      const size = readSvgViewport(svg);
      expect(
        Math.max(size.width, size.height) / Math.min(size.width, size.height),
        id,
      ).toBeLessThanOrEqual(1.5);
    }

    for (const src of imageIconSrcs) {
      expect(HOME_APP_IMAGE_ICON_PRELOADS, src).toContain(src);
    }
    expect(HOME_APP_IMAGE_ICON_PRELOADS).toContain("/app-icons/openclaw.svg");
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

  it("uses the OpenClaw site lobster mark for the OpenClaw workflow logo", () => {
    const icon = homePluginShortcutIcon({
      id: "openclaw",
      runtimeId: "openclaw",
      name: "OpenClaw",
      description: "",
      packageName: "@openclaw/openclaw",
      iconDomain: "openclaw.ai",
    });

    if (icon.kind !== "image") {
      throw new Error("Expected OpenClaw to resolve to a local image icon");
    }
    expect(icon.src).toBe("/app-icons/openclaw.svg");
  });
});

function readSvgViewport(svg: string) {
  const viewBox = svg.match(/\bviewBox="([^"]+)"/)?.[1];
  if (viewBox) {
    const [, , width, height] = viewBox.split(/[ ,]+/).map(Number);
    return { width, height };
  }

  const width = Number(svg.match(/\bwidth="([0-9.]+)"/)?.[1]);
  const height = Number(svg.match(/\bheight="([0-9.]+)"/)?.[1]);
  return { width, height };
}
