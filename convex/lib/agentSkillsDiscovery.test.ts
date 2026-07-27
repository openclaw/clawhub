import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  buildAgentSkillsDiscoveryDocument,
  buildNormalizedAgentSkillArchive,
} from "./agentSkillsDiscovery";

describe("Agent Skills discovery", () => {
  it("builds a pinned v0.2 discovery document", () => {
    expect(
      buildAgentSkillsDiscoveryDocument({
        origin: "https://clawhub.ai",
        ownerHandle: "openclaw",
        slug: "demo",
        displayName: "Demo",
        description: "Install the demo skill.",
        digest: "a".repeat(64),
        version: "1.2.3",
      }),
    ).toEqual({
      $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
      skills: [
        {
          name: "demo",
          type: "archive",
          description: "Install the demo skill.",
          url: "https://clawhub.ai/api/v1/agent-skills/openclaw/demo/archive?version=1.2.3",
          digest: `sha256:${"a".repeat(64)}`,
        },
      ],
    });
  });

  it("normalizes a GitHub skill subtree into an installable root archive", () => {
    const archive = buildNormalizedAgentSkillArchive(
      {
        "skills/demo/skills.md": new TextEncoder().encode("# Demo"),
        "skills/demo/references/setup.md": new TextEncoder().encode("Setup"),
        "skills/other/SKILL.md": new TextEncoder().encode("# Other"),
      },
      "skills/demo",
    );
    const files = unzipSync(archive);

    expect(Object.keys(files).sort()).toEqual(["SKILL.md", "references/setup.md"]);
    expect(strFromU8(files["SKILL.md"]!)).toBe("# Demo");
  });
});
