import { describe, expect, it } from "vitest";
import {
  buildSkillCategoryBrowseHref,
  getSkillCategoryForSkill,
  SKILL_CATEGORIES,
} from "./categories";

describe("skill category helpers", () => {
  it("picks the strongest matching skill category from searchable skill fields", () => {
    const category = getSkillCategoryForSkill({
      slug: "workflow-runner",
      displayName: "Workflow Runner",
      summary: "Build repeatable agent pipelines.",
    });

    expect(category?.slug).toBe("automation");
  });

  it("uses the consumer fallback category for weather skills", () => {
    const category = getSkillCategoryForSkill({
      slug: "weather",
      displayName: "Weather",
      summary: "Get current forecasts.",
    });

    expect(category?.slug).toBe("lifestyle");
  });

  it("does not let generated slug prefixes outweigh the skill summary", () => {
    const category = getSkillCategoryForSkill({
      slug: "dev-jh86ceyb-local-agentic-risk-demo",
      displayName: "Local Agentic Risk Demo",
      summary: "Local fixture for security bucket rendering.",
    });

    expect(category?.slug).toBe("security");
  });

  it("ignores generated dev slug prefixes when no skill content matches a category", () => {
    const category = getSkillCategoryForSkill({
      slug: "dev-jh86ceyb-weather-helper",
      displayName: "Weather Helper",
      summary: "Get current forecasts.",
    });

    expect(category?.slug).toBe("lifestyle");
  });

  it("does not classify unrelated digital device text as Development", () => {
    const category = getSkillCategoryForSkill({
      slug: "navigation-without-screens",
      displayName: "Navigation Without Screens",
      summary: "Physical navigation skills without digital devices. Use for learning maps.",
    });

    expect(category?.slug).not.toBe("development");
  });

  it("prefers Integrations when web3 developer wording is outweighed by API data terms", () => {
    const category = getSkillCategoryForSkill({
      slug: "web3-dev",
      displayName: "Blockscout for Web3 Dev",
      summary:
        "Build web3 applications, scripts, CLIs, bots, mobile apps, and desktop apps that need blockchain data via the Blockscout PRO API over HTTP.",
    });

    expect(category?.slug).toBe("integrations");
  });

  it("still recognizes developer utility wording as Development", () => {
    const category = getSkillCategoryForSkill({
      slug: "developer-utils",
      displayName: "Developer Utils",
      summary: "Utilities for build and debug workflows.",
    });

    expect(category?.slug).toBe("development");
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
