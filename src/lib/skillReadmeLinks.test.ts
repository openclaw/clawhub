import { describe, expect, it } from "vitest";
import { resolveSkillReadmeHref } from "./skillReadmeLinks";

describe("resolveSkillReadmeHref", () => {
  it("routes safe relative README links through the skill file API", () => {
    expect(resolveSkillReadmeHref("references/google-mail/README.md", "api-gateway")).toBe(
      "/api/v1/skills/api-gateway/file?path=references%2Fgoogle-mail%2FREADME.md",
    );
    expect(resolveSkillReadmeHref("./docs/Usage Guide.md#setup", "api-gateway")).toBe(
      "/api/v1/skills/api-gateway/file?path=docs%2FUsage%20Guide.md#setup",
    );
  });

  it("preserves external, root, hash, and query links", () => {
    expect(resolveSkillReadmeHref("https://example.com/docs", "api-gateway")).toBe(
      "https://example.com/docs",
    );
    expect(resolveSkillReadmeHref("/plugins?q=mail", "api-gateway")).toBe("/plugins?q=mail");
    expect(resolveSkillReadmeHref("#usage", "api-gateway")).toBe("#usage");
    expect(resolveSkillReadmeHref("?tab=files", "api-gateway")).toBe("?tab=files");
  });

  it("rejects traversal and unsafe protocols", () => {
    expect(resolveSkillReadmeHref("../other-skill/README.md", "api-gateway")).toBe("");
    expect(resolveSkillReadmeHref("%2e%2e/other-skill/README.md", "api-gateway")).toBe("");
    expect(resolveSkillReadmeHref("javascript:alert(1)", "api-gateway")).toBe("");
  });
});
