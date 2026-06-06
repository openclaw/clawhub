import { describe, expect, it } from "vitest";
import {
  renderPluginInspectorBlockedPublishEmail,
  renderPluginInspectorWarningsEmail,
} from "./packageInspectorEmailTemplates";

describe("package inspector email templates", () => {
  it("renders blocked publish copy with hard findings", () => {
    const email = renderPluginInspectorBlockedPublishEmail({
      packageName: "demo-plugin",
      version: "1.0.0",
      findings: [
        {
          code: "missing-expected-seam",
          message: "missing expected registration registerTool",
        },
      ],
    });

    expect(email.subject).toContain("demo-plugin");
    expect(email.text).toContain("blocked");
    expect(email.text).toContain("missing-expected-seam");
    expect(email.text).toContain("missing expected registration registerTool");
  });

  it("renders warning-only publish copy with non-blocking findings", () => {
    const email = renderPluginInspectorWarningsEmail({
      packageName: "demo-plugin",
      version: "1.0.0",
      warningUrl: "https://clawhub.ai/plugins/demo-plugin#warnings",
      inspectorVersion: "0.4.0",
      targetOpenClawVersion: "0.9.0",
      warnings: [
        {
          code: "legacy-before-agent-start",
          issueClass: "deprecation-warning",
          message: "legacy before_agent_start hook is deprecated",
        },
      ],
    });

    expect(email.subject).toContain("findings");
    expect(email.text).toContain("published");
    expect(email.text).toContain("legacy-before-agent-start");
    expect(email.text).toContain("https://clawhub.ai/plugins/demo-plugin#warnings");
    expect(email.html).toContain("<html");
    expect(email.html).toContain("Plugin Inspector findings");
    expect(email.html).toContain("0.4.0");
    expect(email.html).toContain("0.9.0");
  });

  it("renders nightly warning and error findings as rich HTML", () => {
    const email = renderPluginInspectorWarningsEmail({
      packageName: "demo-plugin",
      version: "1.0.1",
      warningUrl: "https://clawhub.ai/plugins/demo-plugin#warnings",
      inspectorVersion: "0.5.0",
      targetOpenClawVersion: "0.10.0",
      intro:
        "A nightly Plugin Inspector rescan found compatibility findings for an already published plugin.",
      warnings: [
        {
          code: "legacy-before-agent-start",
          issueClass: "deprecation-warning",
          message: "legacy before_agent_start hook is deprecated",
        },
        {
          code: "missing-expected-seam",
          issueClass: "compatibility-error",
          level: "breakage",
          message: "registerTool is no longer available",
        },
      ],
    });

    expect(email.subject).toContain("findings");
    expect(email.text).toContain("nightly Plugin Inspector rescan");
    expect(email.text).toContain("missing-expected-seam");
    expect(email.html).toContain("compatibility-error");
    expect(email.html).toContain("registerTool is no longer available");
  });
});
