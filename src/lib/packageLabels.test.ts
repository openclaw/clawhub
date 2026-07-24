import { describe, expect, it } from "vitest";
import { familyLabel } from "./packageLabels";

describe("packageLabels", () => {
  it("labels skill packages as skills instead of bundle-only", () => {
    expect(familyLabel("skill")).toBe("Skill");
  });

  it("keeps plugin family labels distinct", () => {
    expect(familyLabel("code-plugin")).toBe("Code Plugin");
    expect(familyLabel("bundle-plugin")).toBe("Bundle Plugin");
  });

  it("labels experimental Claw packages", () => {
    expect(familyLabel("claw")).toBe("Claw");
  });
});
