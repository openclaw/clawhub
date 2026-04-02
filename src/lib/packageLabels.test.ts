import { describe, expect, it } from "vitest";
import { familyLabel, packageCapabilityLabel } from "./packageLabels";

describe("packageLabels", () => {
  it("labels skill packages as skills instead of bundle-only", () => {
    expect(familyLabel("skill")).toBe("Skill");
    expect(packageCapabilityLabel("skill", false)).toBe("Skill");
  });

  it("keeps plugin capability labels distinct", () => {
    expect(packageCapabilityLabel("code-plugin", true)).toBe("Executes code");
    expect(packageCapabilityLabel("bundle-plugin", false)).toBe("Bundle only");
  });
});
