import { describe, expect, it } from "vitest";
import {
  CATALOG_TOPIC_LIMIT,
  deriveSkillPrimaryCategory,
  normalizeSkillCategorySlug,
  normalizeCatalogTopics,
  normalizeInferredCatalogTopics,
  resolvePublishedSkillPrimaryCategory,
  resolveSkillPrimaryCategory,
  resolveStoredSkillPrimaryCategory,
  SKILL_CATEGORY_DEFINITIONS,
} from "./catalogMetadata";

describe("catalog metadata", () => {
  it("publishes the approved skill browse taxonomy without a public Other category", () => {
    expect(SKILL_CATEGORY_DEFINITIONS).toHaveLength(15);
    expect(SKILL_CATEGORY_DEFINITIONS.map((category) => category.slug)).not.toContain("other");
    expect(SKILL_CATEGORY_DEFINITIONS.map((category) => category.slug)).toContain(
      "productivity-tasks",
    );
  });

  it("derives a useful skill category and leaves unmatched skills internally uncategorized", () => {
    expect(
      deriveSkillPrimaryCategory({
        slug: "todoist-cli",
        displayName: "Todoist CLI",
        summary: "Manage tasks, projects, and planning.",
      }),
    ).toBe("productivity-tasks");
    expect(
      deriveSkillPrimaryCategory({
        slug: "aardvark-helper",
        displayName: "Aardvark Helper",
        summary: "Handles aardvarks.",
      }),
    ).toBeUndefined();
  });

  it("prefers a stored skill category over inference", () => {
    expect(
      resolveSkillPrimaryCategory({
        primaryCategory: "security-review",
        slug: "todoist-cli",
        displayName: "Todoist CLI",
        summary: "Manage tasks, projects, and planning.",
      }),
    ).toBe("security-review");
  });

  it.each([
    ["mcp-tools", "data-apis"],
    ["prompts", "agent-behavior"],
    ["workflows", "automation-workflows"],
    ["data", "data-apis"],
    ["security", "security-review"],
    ["automation", "automation-workflows"],
    ["other", "domain-utilities"],
  ])("maps the legacy %s category slug to %s", (legacySlug, currentSlug) => {
    expect(normalizeSkillCategorySlug(legacySlug)).toBe(currentSlug);
  });

  it("stores an internal uncategorized value when no public category matches", () => {
    expect(
      resolveStoredSkillPrimaryCategory({
        slug: "misc",
        displayName: "Misc",
        summary: "A focused helper",
      }),
    ).toBe("uncategorized");
  });

  it("preserves omitted publish categories but re-infers explicit auto-detect selections", () => {
    const candidate = {
      existingPrimaryCategory: "security-review",
      slug: "todoist-cli",
      displayName: "Todoist CLI",
      summary: "Manage tasks, projects, and planning.",
    };

    expect(resolvePublishedSkillPrimaryCategory(candidate)).toBe("security-review");
    expect(
      resolvePublishedSkillPrimaryCategory({
        ...candidate,
        requestedPrimaryCategory: "",
      }),
    ).toBe("productivity-tasks");
  });

  it("normalizes, deduplicates, and preserves author topic order", () => {
    expect(normalizeCatalogTopics([" Gmail ", "google calendar", "GMAIL", "Email/API"])).toEqual([
      "gmail",
      "google-calendar",
      "email-api",
    ]);
  });

  it("rejects topic spam beyond the count limit", () => {
    expect(() =>
      normalizeCatalogTopics(
        Array.from({ length: CATALOG_TOPIC_LIMIT + 1 }, (_, index) => `topic-${index}`),
      ),
    ).toThrow(`Topics are limited to ${CATALOG_TOPIC_LIMIT}`);
  });

  it("rejects overlong normalized topics", () => {
    expect(() => normalizeCatalogTopics(["a".repeat(33)])).toThrow(
      "Topics must be 32 characters or fewer",
    );
  });

  it("bounds inferred topics without rejecting source metadata", () => {
    expect(
      normalizeInferredCatalogTopics([
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "a".repeat(33),
      ]),
    ).toEqual(["one", "two", "three", "four", "five", "six", "seven", "eight"]);
  });
});
