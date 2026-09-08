import { describe, expect, it } from "vitest";
import {
  derivePluginCategoryTags,
  getDeclaredPluginCategoriesFromManifest,
  inferPluginCategoriesFromManifest,
  isPluginCategorySlug,
  PLUGIN_CATEGORY_SLUGS,
  resolveStoredPluginCategories,
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

  it("requires a declared secret provider integration before inferring security", () => {
    expect(
      derivePluginCategoryTags({
        family: "code-plugin",
        pluginManifest: { secretProviderIntegrations: {} },
      }),
    ).toEqual(["other"]);
    expect(
      derivePluginCategoryTags({
        family: "code-plugin",
        pluginManifest: { secretProviderIntegrations: { vault: {} } },
      }),
    ).toEqual(["security"]);
  });

  it("uses package manifest declarations before contribution inference", () => {
    expect(
      derivePluginCategoryTags({
        family: "code-plugin",
        pluginManifest: {
          categories: ["security"],
          contracts: { tools: ["demo"] },
        },
      }),
    ).toEqual(["security"]);
  });

  it("rejects invalid package manifest category declarations", () => {
    expect(() =>
      derivePluginCategoryTags({
        family: "code-plugin",
        pluginManifest: { categories: [], contracts: { tools: ["demo"] } },
      }),
    ).toThrow("Plugin manifest categories must contain at least one category");
    expect(() =>
      derivePluginCategoryTags({
        family: "code-plugin",
        pluginManifest: { categories: ["legacy-category"] },
      }),
    ).toThrow('Unknown plugin category slug "legacy-category"');
    expect(() =>
      getDeclaredPluginCategoriesFromManifest({ categories: ["models", "models"] }),
    ).toThrow('Duplicate plugin category slug "models"');
    expect(() => getDeclaredPluginCategoriesFromManifest({ categories: [" models"] })).toThrow(
      'Unknown plugin category slug " models"',
    );
  });

  it("matches the OpenClaw package category contract", () => {
    expect(PLUGIN_CATEGORY_SLUGS).toEqual([
      "channels",
      "models",
      "memory",
      "context",
      "voice",
      "media",
      "web",
      "tools",
      "runtime",
      "gateway",
      "security",
      "other",
    ]);
    expect(getDeclaredPluginCategoriesFromManifest({ categories: ["other", "models"] })).toEqual([
      "other",
      "models",
    ]);
    expect(
      derivePluginCategoryTags({
        family: "code-plugin",
        pluginManifest: { categories: ["other", "models"] },
      }),
    ).toEqual(["other", "models"]);
  });

  it("does not classify skills as plugin categories", () => {
    expect(derivePluginCategoryTags({ family: "skill", categories: ["other"] })).toEqual([]);
  });

  it("maps retired stored categories to Other instead of inferring replacements", () => {
    expect(
      resolveStoredPluginCategories({
        family: "code-plugin",
        categories: ["retired-category"],
        pluginManifest: { contracts: { tools: ["demo"] } },
      }),
    ).toEqual(["other"]);
  });

  it("uses current inferred plugin categories only when author categories are omitted", () => {
    expect(
      resolveStoredPluginCategories({
        family: "code-plugin",
        inferredCategories: ["models", "voice"],
        latestReleaseId: "release:current",
        inferredFromReleaseId: "release:current",
      }),
    ).toEqual(["models", "voice"]);
    expect(
      resolveStoredPluginCategories({
        family: "code-plugin",
        categories: ["other"],
        inferredCategories: ["models"],
        latestReleaseId: "release:current",
        inferredFromReleaseId: "release:current",
      }),
    ).toEqual(["other"]);
    expect(
      resolveStoredPluginCategories({
        family: "code-plugin",
        inferredCategories: ["models"],
        latestReleaseId: "release:new",
        inferredFromReleaseId: "release:old",
      }),
    ).toEqual(["other"]);
  });

  it("validates public category slugs", () => {
    expect(isPluginCategorySlug("security")).toBe(true);
    expect(isPluginCategorySlug("other")).toBe(true);
    expect(isPluginCategorySlug("development")).toBe(false);
  });
});
