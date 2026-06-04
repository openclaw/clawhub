import { describe, expect, it } from "vitest";
import { resolveGitHubSkillReadmeHref, resolveSkillReadmeHref } from "./skillReadmeLinks";

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

describe("resolveGitHubSkillReadmeHref", () => {
  it("routes safe relative README links through the GitHub source blob path", () => {
    const base = "https://github.com/NVIDIA/skills/blob/abc123/skills/aiq-deploy";

    expect(resolveGitHubSkillReadmeHref("references/install.md", base)).toBe(
      "https://github.com/NVIDIA/skills/blob/abc123/skills/aiq-deploy/references/install.md",
    );
    expect(resolveGitHubSkillReadmeHref("./docs/Usage Guide.md#setup", base)).toBe(
      "https://github.com/NVIDIA/skills/blob/abc123/skills/aiq-deploy/docs/Usage%20Guide.md#setup",
    );
  });

  it("preserves external, root, hash, and query links", () => {
    const base = "https://github.com/NVIDIA/skills/blob/abc123/skills/aiq-deploy";

    expect(resolveGitHubSkillReadmeHref("https://example.com/docs", base)).toBe(
      "https://example.com/docs",
    );
    expect(resolveGitHubSkillReadmeHref("/NVIDIA/skills/issues", base)).toBe(
      "/NVIDIA/skills/issues",
    );
    expect(resolveGitHubSkillReadmeHref("#usage", base)).toBe("#usage");
    expect(resolveGitHubSkillReadmeHref("?plain=1", base)).toBe("?plain=1");
  });

  it("rejects traversal and unsafe protocols", () => {
    const base = "https://github.com/NVIDIA/skills/blob/abc123/skills/aiq-deploy";

    expect(resolveGitHubSkillReadmeHref("../other-skill/README.md", base)).toBe("");
    expect(resolveGitHubSkillReadmeHref("%2e%2e/other-skill/README.md", base)).toBe("");
    expect(resolveGitHubSkillReadmeHref("javascript:alert(1)", base)).toBe("");
  });
});
