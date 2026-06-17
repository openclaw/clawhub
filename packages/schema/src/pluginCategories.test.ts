import { describe, expect, it } from "vitest";
import {
  derivePluginCategoryTags,
  inferPluginCategoriesFromManifest,
  isPluginCategorySlug,
} from "./pluginCategories";

describe("plugin categories", () => {
  it("uses exact declared category slugs", () => {
    expect(
      derivePluginCategoryTags({
        family: "code-plugin",
        name: "@openclaw/postgres-api",
        summary: "Fetch data from Postgres",
        categories: ["models", "voice"],
      }),
    ).toEqual(["models", "voice"]);
  });

  it("uses bounded inferred slugs only when declarations are omitted", () => {
    expect(
      derivePluginCategoryTags({
        family: "code-plugin",
        inferredCategories: ["models", "voice"],
      }),
    ).toEqual(["models", "voice"]);
    expect(
      derivePluginCategoryTags({
        family: "code-plugin",
        categories: ["security"],
        inferredCategories: ["models"],
      }),
    ).toEqual(["security"]);
  });

  it("does not infer categories from descriptive plugin metadata", () => {
    expect(
      derivePluginCategoryTags({
        family: "code-plugin",
        name: "@openclaw/postgres-api",
        displayName: "Postgres API",
        summary: "Fetch data from Postgres",
      }),
    ).toEqual(["other"]);
  });

  it("maps manifest contribution surfaces to controlled fallback slugs", () => {
    expect(
      inferPluginCategoriesFromManifest({
        kind: ["memory", "context-engine"],
        channels: ["discord"],
        providers: ["openrouter"],
        contracts: {
          speechProviders: ["openrouter"],
          webSearchProviders: ["openrouter"],
        },
      }),
    ).toEqual(["channels", "models", "memory"]);
    expect(
      derivePluginCategoryTags({
        family: "code-plugin",
        pluginManifest: { contracts: { webSearchProviders: ["exa"] } },
      }),
    ).toEqual(["web"]);
    expect(
      derivePluginCategoryTags({
        family: "code-plugin",
        pluginManifest: { kind: "context-engine" },
      }),
    ).toEqual(["context"]);
  });

  it("prefers valid manifest declarations and ignores unrelated legacy values", () => {
    expect(
      derivePluginCategoryTags({
        family: "code-plugin",
        pluginManifest: {
          categories: ["security"],
          contracts: { tools: ["demo"] },
        },
      }),
    ).toEqual(["security"]);
    expect(
      derivePluginCategoryTags({
        family: "code-plugin",
        pluginManifest: {
          categories: ["legacy-category"],
          contracts: { tools: ["demo"] },
        },
      }),
    ).toEqual(["tools"]);
  });

  it("does not classify skills as plugin categories", () => {
    expect(derivePluginCategoryTags({ family: "skill", categories: ["other"] })).toEqual([]);
  });

  it("validates public category slugs", () => {
    expect(isPluginCategorySlug("security")).toBe(true);
    expect(isPluginCategorySlug("other")).toBe(true);
    expect(isPluginCategorySlug("development")).toBe(false);
  });
});
