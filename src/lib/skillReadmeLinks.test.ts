import { describe, expect, it } from "vitest";
import {
  rewriteSkillReadmeMarkdownUrl,
  sanitizeRenderedSkillReadmeUrl,
} from "./skillReadmeLinks";

const options = { readmePath: "SKILL.md", skillSlug: "demo-skill" };

describe("rewriteSkillReadmeMarkdownUrl", () => {
  it("rewrites README-relative links to the skill file endpoint", () => {
    expect(rewriteSkillReadmeMarkdownUrl("docs/usage.md", options)).toBe(
      "/api/v1/skills/demo-skill/file?path=docs%2Fusage.md",
    );
    expect(rewriteSkillReadmeMarkdownUrl("./img/logo.svg", options)).toBe(
      "/api/v1/skills/demo-skill/file?path=img%2Flogo.svg",
    );
  });

  it("resolves links relative to a nested README path", () => {
    expect(
      rewriteSkillReadmeMarkdownUrl("images/logo.png", {
        readmePath: "docs/SKILL.md",
        skillSlug: "demo-skill",
      }),
    ).toBe("/api/v1/skills/demo-skill/file?path=docs%2Fimages%2Flogo.png");
  });

  it("keeps fragment anchors on rewritten document links", () => {
    expect(rewriteSkillReadmeMarkdownUrl("docs/usage.md#setup", options)).toBe(
      "/api/v1/skills/demo-skill/file?path=docs%2Fusage.md#setup",
    );
  });

  it("preserves absolute URLs, mail, phone, and hash-only anchors", () => {
    expect(rewriteSkillReadmeMarkdownUrl("https://example.com/docs", options)).toBe(
      "https://example.com/docs",
    );
    expect(rewriteSkillReadmeMarkdownUrl("mailto:security@example.com", options)).toBe(
      "mailto:security@example.com",
    );
    expect(rewriteSkillReadmeMarkdownUrl("tel:+15555550100", options)).toBe(
      "tel:+15555550100",
    );
    expect(rewriteSkillReadmeMarkdownUrl("#usage", options)).toBe("#usage");
  });

  it("sanitizes traversal, root-absolute, backslash, and unsafe scheme targets", () => {
    expect(rewriteSkillReadmeMarkdownUrl("../secret.md", options)).toBeNull();
    expect(rewriteSkillReadmeMarkdownUrl("%2e%2e/secret.md", options)).toBeNull();
    expect(rewriteSkillReadmeMarkdownUrl("/secret.md", options)).toBeNull();
    expect(rewriteSkillReadmeMarkdownUrl("docs\\secret.md", options)).toBeNull();
    expect(rewriteSkillReadmeMarkdownUrl("javascript:alert(1)", options)).toBeNull();
  });
});

describe("sanitizeRenderedSkillReadmeUrl", () => {
  it("allows rewritten site paths, safe schemes, and hash anchors", () => {
    expect(sanitizeRenderedSkillReadmeUrl("/api/v1/skills/demo/file?path=SKILL.md")).toBe(
      "/api/v1/skills/demo/file?path=SKILL.md",
    );
    expect(sanitizeRenderedSkillReadmeUrl("tel:+15555550100")).toBe("tel:+15555550100");
    expect(sanitizeRenderedSkillReadmeUrl("#usage")).toBe("#usage");
  });

  it("removes unrewritten relative paths and unsafe schemes", () => {
    expect(sanitizeRenderedSkillReadmeUrl("docs/usage.md")).toBe("");
    expect(sanitizeRenderedSkillReadmeUrl("javascript:alert(1)")).toBe("");
  });
});
