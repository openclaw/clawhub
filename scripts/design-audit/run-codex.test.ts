/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { designAuditCodexArguments } from "./run-codex";

describe("design audit Codex CLI arguments", () => {
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

  it.each([
    { configuration: "default", env: {} },
    {
      configuration: "explicit model settings",
      env: {
        DESIGN_AUDIT_CODEX_MODEL: "custom-model",
        DESIGN_AUDIT_REASONING_EFFORT: "medium",
        DESIGN_AUDIT_SERVICE_TIER: "fast",
      },
    },
  ])("keeps the workspace sandbox and restricted networking with $configuration", ({ env }) => {
    const args = designAuditCodexArguments("/tmp/result.json", [], env);
    expect(args.filter((arg) => arg === "--sandbox" || arg.startsWith("--sandbox="))).toEqual([
      "--sandbox",
    ]);
    const sandboxIndex = args.indexOf("--sandbox");
    expect(args.slice(sandboxIndex, sandboxIndex + 2)).toEqual(["--sandbox", "workspace-write"]);
    expect(args).not.toContain("danger-full-access");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args.join("\n")).not.toMatch(/\b(?:network_access|use_legacy_landlock)\s*=\s*true\b/);
  });
});
