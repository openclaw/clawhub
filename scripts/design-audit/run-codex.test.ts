/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { designAuditCodexArguments } from "./run-codex";

describe("design audit Codex model policy", () => {
  it("passes Sol high Standard to the actual CLI argument builder", () => {
    const args = designAuditCodexArguments("/tmp/result.json", ["/tmp/screenshot.png"], {});
    expect(args).toContain("gpt-6.1-sol");
    expect(args).toContain("model_reasoning_effort=high");
    expect(args).toContain("service_tier=default");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("/tmp/screenshot.png");
  });
  it("preserves explicit model, effort and tier overrides", () => {
    const args = designAuditCodexArguments("/tmp/result.json", [], {
      DESIGN_AUDIT_CODEX_MODEL: "custom-model",
      DESIGN_AUDIT_REASONING_EFFORT: "medium",
      DESIGN_AUDIT_SERVICE_TIER: "fast",
    });
    expect(args).toContain("custom-model");
    expect(args).toContain("model_reasoning_effort=medium");
    expect(args).toContain("service_tier=fast");
  });
});
