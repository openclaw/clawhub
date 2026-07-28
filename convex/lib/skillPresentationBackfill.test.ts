import { describe, expect, it } from "vitest";
import {
  preserveHistoricalHostedIcon,
  resolveHistoricalSkillPresentation,
} from "./skillPresentationBackfill";

describe("resolveHistoricalSkillPresentation", () => {
  it("adopts OpenAI presentation values when stored values came from frontmatter", () => {
    expect(
      resolveHistoricalSkillPresentation({
        slug: "demo-skill",
        currentDisplayName: "Demo Skill",
        currentSummary: "Frontmatter summary",
        frontmatter: { name: "demo-skill", description: "Frontmatter summary" },
        openAi: {
          displayName: "OpenAI Demo",
          shortDescription: "OpenAI summary",
          iconPaths: ["assets/icon.png"],
        },
      }),
    ).toEqual({
      displayName: "OpenAI Demo",
      displayNameSource: "openai",
      summary: "OpenAI summary",
      summarySource: "openai",
      iconPaths: ["assets/icon.png"],
    });
  });

  it("preserves historical publisher title and summary overrides", () => {
    expect(
      resolveHistoricalSkillPresentation({
        slug: "demo-skill",
        currentDisplayName: "Publisher Title",
        currentSummary: "Publisher summary",
        frontmatter: { name: "demo-skill", description: "Frontmatter summary" },
        openAi: {
          displayName: "OpenAI Demo",
          shortDescription: "OpenAI summary",
          iconPaths: ["assets/icon.png"],
        },
      }),
    ).toEqual({
      displayName: "Publisher Title",
      displayNameSource: "publisher",
      summary: "Publisher summary",
      summarySource: "publisher",
      iconPaths: ["assets/icon.png"],
    });
  });

  it("strips emoji while preserving an explicit publisher title", () => {
    expect(
      resolveHistoricalSkillPresentation({
        slug: "demo-skill",
        currentDisplayName: "✨ Publisher Title",
        frontmatter: {},
        openAi: { displayName: "OpenAI Demo" },
      }).displayName,
    ).toBe("Publisher Title");
  });
});

describe("preserveHistoricalHostedIcon", () => {
  const hostedIcon = `/api/v1/skill-icons/${"a".repeat(64)}`;

  it("preserves an immutable hosted icon when source revalidation is unavailable", () => {
    expect(preserveHistoricalHostedIcon(undefined, hostedIcon)).toBe(hostedIcon);
  });

  it("does not preserve arbitrary legacy icon values", () => {
    expect(
      preserveHistoricalHostedIcon("https://example.com/icon.png", "icon.png"),
    ).toBeUndefined();
  });
});
