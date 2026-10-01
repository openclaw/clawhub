import { describe, expect, it } from "vitest";
import {
  buildSkillPresentationIconPath,
  MAX_SKILL_PRESENTATION_DISPLAY_NAME_LENGTH,
  MAX_SKILL_PRESENTATION_SHORT_DESCRIPTION_LENGTH,
  parseOpenAiSkillPresentation,
  resolveSkillPresentation,
  stripPresentationEmoji,
  validateSkillPresentationIcon,
} from "./skillPresentation";

const encoder = new TextEncoder();
const validPng = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);
const validJpeg = Uint8Array.from(
  Buffer.from(
    "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z",
    "base64",
  ),
);
const validWebp = Uint8Array.from(
  Buffer.from(
    "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=",
    "base64",
  ),
);

describe("parseOpenAiSkillPresentation", () => {
  it("keeps supported interface metadata and resolves the preferred icon path", () => {
    expect(
      parseOpenAiSkillPresentation(`
interface:
  display_name: "✨ Better Search"
  short_description: Search across project knowledge.
  icon_small: ./assets/icon-small.png
  icon_large: assets/icon-large.webp
  brand_color: "#112233"
  default_prompt: Ignore this for catalog rendering.
policy:
  allow_implicit_invocation: true
`),
    ).toEqual({
      displayName: "✨ Better Search",
      shortDescription: "Search across project knowledge.",
      iconPaths: ["assets/icon-small.png", "assets/icon-large.webp"],
    });
  });

  it("drops traversal, absolute, URL, and malformed icon references", () => {
    for (const icon of ["../secret.png", "/tmp/icon.png", "https://example.com/icon.png"]) {
      expect(
        parseOpenAiSkillPresentation(`interface:\n  display_name: Demo\n  icon_small: ${icon}\n`),
      ).toEqual({ displayName: "Demo" });
    }
    expect(parseOpenAiSkillPresentation("{not yaml")).toBeNull();
  });

  it("drops presentation text that exceeds catalog field limits", () => {
    expect(
      parseOpenAiSkillPresentation(`interface:
  display_name: ${"n".repeat(MAX_SKILL_PRESENTATION_DISPLAY_NAME_LENGTH + 1)}
  short_description: ${"s".repeat(MAX_SKILL_PRESENTATION_SHORT_DESCRIPTION_LENGTH + 1)}
  icon_small: assets/icon.png
`),
    ).toEqual({ iconPaths: ["assets/icon.png"] });
  });
});

describe("resolveSkillPresentation", () => {
  it("uses publisher overrides before OpenAI metadata and SKILL.md metadata", () => {
    expect(
      resolveSkillPresentation({
        publisherDisplayName: "🚀 Publisher Name",
        publisherSummary: "Publisher summary.",
        openAi: {
          displayName: "OpenAI Name",
          shortDescription: "OpenAI summary.",
          iconPaths: ["assets/icon.png"],
        },
        skillDisplayName: "Skill Name",
        skillDescription: "Skill summary.",
        slug: "skill-name",
      }),
    ).toEqual({
      displayName: "Publisher Name",
      displayNameSource: "publisher",
      summary: "Publisher summary.",
      summarySource: "publisher",
      iconPaths: ["assets/icon.png"],
    });
  });

  it("falls back through OpenAI metadata, SKILL.md, and slug while removing emoji", () => {
    expect(
      resolveSkillPresentation({
        openAi: { displayName: "🧭 OpenAI Name", shortDescription: "OpenAI summary." },
        skillDisplayName: "Skill Name",
        skillDescription: "Skill summary.",
        slug: "skill-name",
      }),
    ).toEqual({
      displayName: "OpenAI Name",
      displayNameSource: "openai",
      summary: "OpenAI summary.",
      summarySource: "openai",
    });
    expect(resolveSkillPresentation({ slug: "skill-name" })).toEqual({
      displayName: "Skill Name",
      displayNameSource: "slug",
    });
  });
});

describe("skill presentation icons", () => {
  it("accepts matching PNG, JPEG, WebP, and SVG assets", () => {
    const fixtures = [
      {
        path: "assets/icon.png",
        bytes: validPng,
        contentType: "image/png",
      },
      {
        path: "assets/icon.jpg",
        bytes: validJpeg,
        contentType: "image/jpeg",
      },
      {
        path: "assets/icon.webp",
        bytes: validWebp,
        contentType: "image/webp",
      },
      {
        path: "assets/icon.svg",
        bytes: encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        contentType: "image/svg+xml",
      },
    ];

    for (const fixture of fixtures) {
      expect(validateSkillPresentationIcon(fixture)).toEqual({
        contentType: fixture.contentType,
        size: fixture.bytes.byteLength,
      });
    }
  });

  it("rejects mismatched, active SVG, and oversized assets", () => {
    expect(() =>
      validateSkillPresentationIcon({
        path: "icon.gif",
        bytes: encoder.encode("GIF89a"),
      }),
    ).toThrow(/unsupported/i);
    expect(() =>
      validateSkillPresentationIcon({
        path: "icon.png",
        bytes: encoder.encode("<svg></svg>"),
      }),
    ).toThrow(/invalid png/i);
    expect(() =>
      validateSkillPresentationIcon({
        path: "icon.png",
        bytes: validPng.slice(0, 24),
      }),
    ).toThrow(/invalid png/i);
    expect(() =>
      validateSkillPresentationIcon({
        path: "icon.svg",
        bytes: encoder.encode("<svg><script>alert(1)</script></svg>"),
      }),
    ).toThrow(/unsafe svg/i);
    expect(() =>
      validateSkillPresentationIcon({
        path: "icon.png",
        bytes: new Uint8Array(512 * 1024 + 1),
      }),
    ).toThrow(/512KB/i);
  });

  it("builds stable content-addressed paths", () => {
    expect(buildSkillPresentationIconPath("A".repeat(64))).toBe(
      `/api/v1/skill-icons/${"a".repeat(64)}`,
    );
    expect(() => buildSkillPresentationIconPath("nope")).toThrow(/sha-256/i);
  });
});

describe("stripPresentationEmoji", () => {
  it("removes emoji sequences and tidies the rendered title", () => {
    expect(stripPresentationEmoji("  🚀 Super ✨ Skill  ")).toBe("Super Skill");
    expect(stripPresentationEmoji("🧑🏽‍💻 Dev Tools")).toBe("Dev Tools");
  });
});
