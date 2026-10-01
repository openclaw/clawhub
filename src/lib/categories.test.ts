import { describe, expect, it } from "vitest";
import {
  buildPluginTopicBrowseHref,
  buildSkillCategoryBrowseHref,
  buildSkillTopicBrowseHref,
  formatCatalogTopicLabel,
  getSkillCategoryForSkill,
  resolvePluginBrowseCategorySlug,
  resolveSkillBrowseCategorySlug,
  SKILL_CATEGORIES,
} from "./categories";

describe("skill category helpers", () => {
  it("maps legacy browser category slugs without accepting unknown values", () => {
    expect(resolveSkillBrowseCategorySlug("workflows")).toBe("automation");
    expect(resolveSkillBrowseCategorySlug("mcp-tools")).toBe("integrations");
    expect(resolveSkillBrowseCategorySlug("unknown")).toBeUndefined();

    expect(resolvePluginBrowseCategorySlug("data")).toBe("tools");
    expect(resolvePluginBrowseCategorySlug("dev-tools")).toBe("runtime");
    expect(resolvePluginBrowseCategorySlug("unknown")).toBeUndefined();
    expect(resolvePluginBrowseCategorySlug("constructor")).toBeUndefined();
    expect(resolveSkillBrowseCategorySlug("toString")).toBeUndefined();
  });

  it("uses Other when no category has been explicitly stored", () => {
    const category = getSkillCategoryForSkill({
      slug: "workflow-runner",
      displayName: "Workflow Runner",
      summary: "Build repeatable agent pipelines.",
    });

    expect(category?.slug).toBe("other");
  });

  it("builds browse links from the category filter slug", () => {
    const workflows = SKILL_CATEGORIES.find((category) => category.slug === "automation");

    expect(workflows ? buildSkillCategoryBrowseHref(workflows) : null).toBe(
      "/skills?category=automation",
    );
  });

  it("prefers a stored category over inferred skill text", () => {
    const category = getSkillCategoryForSkill({
      categories: ["operations"],
      slug: "todoist-cli",
      displayName: "Todoist CLI",
      summary: "Manage tasks, projects, and planning.",
    });

    expect(category?.slug).toBe("operations");
  });
});

describe("catalog topic browse helpers", () => {
  it("formats topic labels with a hash prefix", () => {
    expect(formatCatalogTopicLabel("Agent Security")).toBe("#agent-security");
  });

  it("builds skill and plugin browse links from topic slugs", () => {
    expect(buildSkillTopicBrowseHref("security-audit")).toBe("/skills?topic=security-audit");
    expect(buildPluginTopicBrowseHref("security-audit")).toBe("/plugins?topic=security-audit");
  });
});
