/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

vi.mock("../scanSkills.js", () => ({
  findSkillFolders: vi.fn(async (root: string) => {
    if (root.endsWith("/with-skill")) {
      return [{ folder: `${root}/demo`, slug: "demo", displayName: "Demo" }];
    }
    return [];
  }),
}));

const { scanRootsWithLabels } = await import("./syncHelpers.js");

describe("scanRootsWithLabels", () => {
  it("attaches labels to roots with skills", async () => {
    const roots = ["/tmp/with-skill", "/tmp/empty", "/tmp/with-skill"];
    const labels = { "/tmp/with-skill": "Agent: Work" };

    const result = await scanRootsWithLabels(roots, labels);

    expect(result.rootsWithSkills).toEqual(["/tmp/with-skill"]);
    expect(result.rootLabels).toEqual({ "/tmp/with-skill": "Agent: Work" });
    expect(result.skills.map((skill) => skill.slug)).toEqual(["demo"]);
  });
});
