import { PLUGIN_CATEGORY_DEFINITIONS } from "clawhub-schema/pluginCategories";
import { Paintbrush } from "lucide-react";
import { describe, expect, it } from "vitest";
import { getCategoryIconComponent } from "./categoryIcons";

describe("plugin category icons", () => {
  it("resolves Themes and every canonical plugin category to a real icon", () => {
    const themes = PLUGIN_CATEGORY_DEFINITIONS.find(({ slug }) => slug === "themes");
    expect(themes?.label).toBe("Themes");
    expect(getCategoryIconComponent(themes?.icon)).toBe(Paintbrush);
    for (const category of PLUGIN_CATEGORY_DEFINITIONS) {
      expect(getCategoryIconComponent(category.icon)).not.toBeNull();
    }
  });
});
