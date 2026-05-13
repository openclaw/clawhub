import { describe, expect, it } from "vitest";
import { derivePluginCategoryTags, isPluginCategorySlug } from "./pluginCategories";

describe("plugin categories", () => {
  it("derives categories from plugin metadata", () => {
    expect(
      derivePluginCategoryTags({
        family: "code-plugin",
        name: "@openclaw/postgres-api",
        displayName: "Postgres API",
        summary: "Fetch data from Postgres",
        capabilityTags: ["external-service:postgres"],
      }),
    ).toContain("data");
  });

  it("does not match category signals inside unrelated words", () => {
    expect(
      derivePluginCategoryTags({
        family: "code-plugin",
        name: "capability-helper",
        displayName: "Capability Helper",
        summary: "Capability metadata formatter",
        capabilityTags: ["capability"],
      }),
    ).not.toContain("data");

    expect(
      derivePluginCategoryTags({
        family: "code-plugin",
        name: "official-helper",
        displayName: "Official Helper",
        summary: "Official metadata helper",
        capabilityTags: ["official"],
      }),
    ).not.toContain("deployment");
  });

  it("does not classify skills as plugin categories", () => {
    expect(
      derivePluginCategoryTags({
        family: "skill",
        name: "api-skill",
        displayName: "API Skill",
        summary: "Fetch data",
      }),
    ).toEqual([]);
  });

  it("validates public category slugs", () => {
    expect(isPluginCategorySlug("security")).toBe(true);
    expect(isPluginCategorySlug("other")).toBe(false);
  });
});
