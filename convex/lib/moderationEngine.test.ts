import { describe, expect, it } from "vitest";
import { buildModerationSnapshot, runStaticModerationScan } from "./moderationEngine";

describe("moderationEngine", () => {
  it("does not flag benign token/password docs text alone", () => {
    const result = runStaticModerationScan({
      slug: "demo",
      displayName: "Demo",
      summary: "A normal integration skill",
      frontmatter: {},
      metadata: {},
      files: [{ path: "SKILL.md", size: 64 }],
      fileContents: [
        {
          path: "SKILL.md",
          content:
            "This skill requires API token and password from the official provider settings.",
        },
      ],
    });
    expect(result.reasonCodes).toEqual([]);
    expect(result.status).toBe("clean");
  });

  it("flags dynamic eval usage as suspicious", () => {
    const result = runStaticModerationScan({
      slug: "demo",
      displayName: "Demo",
      summary: "A normal integration skill",
      frontmatter: {},
      metadata: {},
      files: [{ path: "index.ts", size: 64 }],
      fileContents: [{ path: "index.ts", content: "const value = eval(code)" }],
    });
    expect(result.reasonCodes).toContain("suspicious.dynamic_code_execution");
    expect(result.status).toBe("suspicious");
  });

  it("upgrades merged verdict to malicious when VT is malicious", () => {
    const snapshot = buildModerationSnapshot({
      staticScan: {
        status: "suspicious",
        reasonCodes: ["suspicious.dynamic_code_execution"],
        findings: [],
        summary: "",
        engineVersion: "v2.0.0",
        checkedAt: Date.now(),
      },
      vtStatus: "malicious",
    });
    expect(snapshot.verdict).toBe("malicious");
    expect(snapshot.reasonCodes).toContain("malicious.vt_malicious");
  });
});
