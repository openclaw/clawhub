import { describe, expect, it } from "vitest";
import { isSkillCardPath, selectTrustedSkillCardFile, sourceSkillVersionFiles } from "./skillCards";

describe("skill card file helpers", () => {
  it("detects reserved Skill Card paths after upload-style dot prefixes", () => {
    expect(isSkillCardPath("skill-card.md")).toBe(true);
    expect(isSkillCardPath("./skill-card.md")).toBe(true);
    expect(isSkillCardPath(".//skill-card.md")).toBe(true);
    expect(isSkillCardPath("references/skill-card.md")).toBe(false);
  });

  it("keeps legacy publisher-authored Skill Cards in source file inputs", () => {
    const files = [
      { path: "SKILL.md", sha256: "a" },
      { path: "references/guide.md", sha256: "b" },
      { path: "skill-card.md", sha256: "publisher-authored" },
    ];

    expect(sourceSkillVersionFiles(files)).toEqual(files);
  });

  it("keeps generated Skill Cards out of source file inputs after server provenance exists", () => {
    const files = [
      { path: "SKILL.md", sha256: "a" },
      { path: "references/guide.md", sha256: "b" },
      { path: " skill-card.md ", sha256: "generated" },
    ];

    expect(
      sourceSkillVersionFiles(files, { generatedBundleFingerprints: ["generated-bundle"] }),
    ).toEqual([
      { path: "SKILL.md", sha256: "a" },
      { path: "references/guide.md", sha256: "b" },
    ]);
  });

  it("selects publisher-supplied Skill Cards only when explicitly trusted", async () => {
    const files = [
      { path: "SKILL.md", sha256: "a" },
      { path: "skill-card.md", sha256: "publisher-authored" },
    ];

    await expect(selectTrustedSkillCardFile(files, [])).resolves.toBeNull();
    await expect(
      selectTrustedSkillCardFile(files, [], { allowPublisherSupplied: true }),
    ).resolves.toEqual({ path: "skill-card.md", sha256: "publisher-authored" });
  });
});
