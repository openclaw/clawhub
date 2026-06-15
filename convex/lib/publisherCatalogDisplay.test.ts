import { describe, expect, it } from "vitest";
import { buildGitHubSkillCatalogDisplay } from "./publisherCatalogDisplay";

const baseItem = {
  kind: "skill" as const,
  summary: null,
  icon: null,
  href: "/nvidia/example",
  installs: 0,
  stars: 0,
  isOfficial: true,
  updatedAt: 1,
  sourceBacked: true,
  sourceRepo: "NVIDIA/skills",
  sourcePath: null,
  sourceVerifiedCommit: null,
};

describe("buildGitHubSkillCatalogDisplay", () => {
  it("groups source-backed skills by manifest entries and ignores missing entries", () => {
    const display = buildGitHubSkillCatalogDisplay({
      sources: [
        {
          _id: "githubSkillSources:nvidia",
          repo: "NVIDIA/skills",
          displayManifestStatus: "ok",
          displayManifest: {
            notGrouped: "bottom",
            groupings: [
              {
                title: "Agentic AI",
                description: "Agentic AI skills.",
                skills: ["aiq-deploy", "missing-upstream-entry"],
              },
              {
                title: "Vision AI",
                skills: ["vision-helper"],
              },
            ],
          },
        },
      ],
      items: [
        {
          ...baseItem,
          _id: "skills:aiq-deploy",
          displayName: "AIQ Deploy",
          slug: "aiq-deploy",
          sourceId: "githubSkillSources:nvidia",
        },
        {
          ...baseItem,
          _id: "skills:vision-helper",
          displayName: "Vision Helper",
          slug: "vision-helper",
          sourceId: "githubSkillSources:nvidia",
        },
      ],
    });

    expect(display).toMatchObject({
      mode: "grouped",
      sourceRepos: ["NVIDIA/skills"],
      sections: [
        {
          title: "Agentic AI",
          description: "Agentic AI skills.",
          sourceRepo: "NVIDIA/skills",
          items: [{ displayName: "AIQ Deploy" }],
        },
        {
          title: "Vision AI",
          sourceRepo: "NVIDIA/skills",
          items: [{ displayName: "Vision Helper" }],
        },
      ],
    });
  });

  it("matches manifest entries by normalized display name and places unlisted skills at the requested edge", () => {
    const display = buildGitHubSkillCatalogDisplay({
      sources: [
        {
          _id: "githubSkillSources:nvidia",
          repo: "NVIDIA/skills",
          displayManifestStatus: "ok",
          displayManifest: {
            notGrouped: "top",
            groupings: [
              {
                title: "Physical AI",
                skills: ["Isaac Sim Helper"],
              },
            ],
          },
        },
      ],
      items: [
        {
          ...baseItem,
          _id: "skills:isaac-sim-helper",
          displayName: "Isaac Sim Helper",
          slug: "isaac-sim-helper",
          sourceId: "githubSkillSources:nvidia",
        },
        {
          ...baseItem,
          _id: "skills:extra",
          displayName: "Extra Skill",
          slug: "extra",
          sourceId: "githubSkillSources:nvidia",
        },
      ],
    });

    expect(display?.sections.map((section) => section.title)).toEqual([
      "Other skills",
      "Physical AI",
    ]);
    expect(display?.sections[0]?.items.map((item) => item.displayName)).toEqual(["Extra Skill"]);
  });

  it("falls back to the normal catalog when the source manifest is missing or invalid", () => {
    const display = buildGitHubSkillCatalogDisplay({
      sources: [
        {
          _id: "githubSkillSources:nvidia",
          repo: "NVIDIA/skills",
          displayManifestStatus: "invalid",
        },
      ],
      items: [
        {
          ...baseItem,
          _id: "skills:aiq-deploy",
          displayName: "AIQ Deploy",
          slug: "aiq-deploy",
          sourceId: "githubSkillSources:nvidia",
        },
      ],
    });

    expect(display).toBeNull();
  });

  it("keeps source-backed skills from non-renderable sources in other skills", () => {
    const display = buildGitHubSkillCatalogDisplay({
      sources: [
        {
          _id: "githubSkillSources:nvidia",
          repo: "NVIDIA/skills",
          displayManifestStatus: "ok",
          displayManifest: {
            notGrouped: "bottom",
            groupings: [
              {
                title: "Agentic AI",
                skills: ["aiq-deploy"],
              },
            ],
          },
        },
        {
          _id: "githubSkillSources:invalid",
          repo: "example/skills",
          displayManifestStatus: "invalid",
        },
      ],
      items: [
        {
          ...baseItem,
          _id: "skills:aiq-deploy",
          displayName: "AIQ Deploy",
          slug: "aiq-deploy",
          sourceId: "githubSkillSources:nvidia",
        },
        {
          ...baseItem,
          _id: "skills:unlisted",
          displayName: "Unlisted Source Skill",
          slug: "unlisted-source-skill",
          sourceRepo: "example/skills",
          sourceId: "githubSkillSources:invalid",
        },
      ],
    });

    expect(display?.sections.map((section) => section.title)).toEqual([
      "Agentic AI",
      "Other skills",
    ]);
    expect(display?.sections.at(-1)?.items.map((item) => item.displayName)).toEqual([
      "Unlisted Source Skill",
    ]);
  });
});
