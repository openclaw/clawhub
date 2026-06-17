import { describe, expect, it } from "vitest";
import {
  CATALOG_CATEGORY_LIMIT,
  CATALOG_TOPIC_LIMIT,
  getCatalogTopicSlugs,
  inferSkillCategories,
  normalizeCatalogTopics,
  normalizePluginCategories,
  normalizeSkillCategories,
  PLUGIN_CATEGORY_DEFINITIONS,
  resolvePluginCategories,
  resolveSkillCategories,
  resolveStoredSkillCategories,
  SKILL_CATEGORY_DEFINITIONS,
} from "./catalogMetadata";

describe("catalog metadata", () => {
  it("publishes separate controlled slug registries with an Other fallback", () => {
    expect(PLUGIN_CATEGORY_DEFINITIONS.map((category) => category.slug)).toEqual([
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
    expect(SKILL_CATEGORY_DEFINITIONS.map((category) => category.slug)).toEqual([
      "integrations",
      "automation",
      "research",
      "development",
      "productivity",
      "communication",
      "creative",
      "knowledge",
      "agents",
      "operations",
      "security",
      "finance",
      "lifestyle",
      "other",
    ]);
  });

  it("accepts only declared category slugs and preserves author order", () => {
    expect(normalizePluginCategories(["models", "voice", "models", "media"])).toEqual([
      "models",
      "voice",
      "media",
    ]);

    expect(() => normalizePluginCategories(["model provider"])).toThrow(
      'Unknown plugin category slug "model provider"',
    );
    expect(() => normalizeSkillCategories(["web"])).toThrow('Unknown skill category slug "web"');
  });

  it("caps category declarations at the shared maximum", () => {
    expect(CATALOG_CATEGORY_LIMIT).toBe(3);
    expect(() =>
      normalizeSkillCategories(["integrations", "automation", "research", "development"]),
    ).toThrow("Categories are limited to 3");
  });

  it("keeps the Other fallback mutually exclusive with specific categories", () => {
    expect(normalizePluginCategories(["other", "models"])).toEqual(["models"]);
    expect(normalizeSkillCategories(["development", "other"])).toEqual(["development"]);
  });

  it("uses inferred registry slugs only when declarations are omitted", () => {
    expect(
      resolvePluginCategories({
        declared: ["voice"],
        inferred: ["models"],
      }),
    ).toEqual(["voice"]);
    expect(resolvePluginCategories({ inferred: ["models"] })).toEqual(["models"]);
    expect(resolvePluginCategories({ declared: [], inferred: ["models"] })).toEqual(["other"]);
    expect(resolveSkillCategories({})).toEqual(["other"]);
  });

  it("maps fallback inference to controlled slugs", () => {
    expect(
      inferSkillCategories({
        slug: "todoist-workflows",
        displayName: "Todoist Workflows",
        summary: "Automate task and project workflows",
      }),
    ).toEqual(["automation", "productivity"]);
  });

  it("maps legacy skills without stored categories through controlled fallback inference", () => {
    expect(
      resolveStoredSkillCategories({
        slug: "todoist-workflows",
        displayName: "Todoist Workflows",
        summary: "Automate task and project workflows",
      }),
    ).toEqual(["automation", "productivity"]);
  });

  it("maps retired stored skill categories through controlled fallback inference", () => {
    expect(
      resolveStoredSkillCategories({
        slug: "todoist-workflows",
        displayName: "Todoist Workflows",
        summary: "Automate task and project workflows",
        categories: ["retired-category"],
      }),
    ).toEqual(["automation", "productivity"]);
  });

  it("preserves topic display values while deriving normalized lookup slugs", () => {
    const topics = normalizeCatalogTopics([
      " GPU Development ",
      "Travel Planning",
      "gpu-development",
    ]);

    expect(topics).toEqual(["GPU Development", "Travel Planning"]);
    expect(getCatalogTopicSlugs(topics)).toEqual(["gpu-development", "travel-planning"]);
  });

  it("caps author topics at five values", () => {
    expect(CATALOG_TOPIC_LIMIT).toBe(5);
    expect(() => normalizeCatalogTopics(["one", "two", "three", "four", "five", "six"])).toThrow(
      "Topics are limited to 5",
    );
  });

  it("rejects exact platform trust labels while leaving contextual topics to moderation", () => {
    expect(() => normalizeCatalogTopics(["Official"])).toThrow(
      'Topic "Official" is reserved by ClawHub',
    );
    expect(normalizeCatalogTopics(["security-research", "malware-analysis"])).toEqual([
      "security-research",
      "malware-analysis",
    ]);
  });
});
