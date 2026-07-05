import { describe, expect, it } from "vitest";
import * as schema from ".";
import {
  findSkillPackageFileCaseCollisions,
  formatSkillPackageFileCaseCollisionError,
} from "./skillPackageFiles";

describe("clawhub-schema skillPackageFiles", () => {
  it("detects case-colliding skill readme files in the same folder", () => {
    const collisions = findSkillPackageFileCaseCollisions([
      "SKILL.md",
      "skill.md",
      "nested/SKILL.md",
      "other/skill.md",
    ]);

    expect(collisions).toEqual([
      {
        canonicalName: "SKILL.md",
        paths: ["skill.md", "SKILL.md"],
      },
    ]);
  });

  it("detects case-colliding protocol files without requiring protocols", () => {
    const collisions = findSkillPackageFileCaseCollisions([
      "docs/PROTOCOL.md",
      "docs/protocol.md",
      "SKILL.md",
    ]);

    expect(formatSkillPackageFileCaseCollisionError(collisions)).toBe(
      "Remove case-colliding PROTOCOL.md files: docs/protocol.md, docs/PROTOCOL.md.",
    );
  });

  it("detects case-colliding skill package files when only a directory segment differs", () => {
    const collisions = findSkillPackageFileCaseCollisions(["Docs/PROTOCOL.md", "docs/PROTOCOL.md"]);

    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toMatchObject({ canonicalName: "PROTOCOL.md" });
    expect(collisions[0]?.paths).toEqual(
      expect.arrayContaining(["Docs/PROTOCOL.md", "docs/PROTOCOL.md"]),
    );
  });

  it("keeps lowercase and legacy skill aliases compatible when they do not collide", () => {
    expect(
      findSkillPackageFileCaseCollisions(["skill.md", "legacy/skills.md", "nested/SKILL.md"]),
    ).toEqual([]);
  });

  it("re-exports helpers from index", () => {
    expect(typeof schema.findSkillPackageFileCaseCollisions).toBe("function");
  });
});
