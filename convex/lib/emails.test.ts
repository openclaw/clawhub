import { describe, expect, it } from "vitest";
import {
  APPEALS_URL,
  buildMaliciousArtifactEmail,
  buildBanNotificationEmail,
  buildPackageInspectorFindingsEmail,
  buildRestoredAccountEmail,
} from "./emails";

describe("moderation notification email copy", () => {
  it("builds public-safe malicious skill context with appeal but no local scan guidance", () => {
    const email = buildBanNotificationEmail({
      handle: "gingiris",
      source: "autoban",
      reason: "malicious.llm_malicious",
      artifact: { kind: "skill", name: "gingiris-launch" },
      trigger: "scanner.llm.malicious",
    });

    expect(email.subject).toBe("Your ClawHub account was disabled");
    expect(email.context).toMatchObject({
      appealUrl: APPEALS_URL,
      artifact: { kind: "skill", name: "gingiris-launch" },
      scannerLabel: "ClawScan",
      findingSummary: "ClawScan classified the uploaded skill as malicious.",
    });
    expect(email.text).toContain("Skill: gingiris-launch");
    expect(email.text).not.toContain("Scanner:");
    expect(email.html).not.toContain("<strong>Scanner:</strong>");
    expect(email.text).not.toContain("republishing");
    expect(email.html).not.toContain("republishing");
    expect(email.text).not.toContain("To support your appeal, include scan results");
    expect(email.html).not.toContain("Include scan results with your appeal");
    expect(email.text).toContain("Appeal: https://appeals.openclaw.ai/");
    expect(email.text).not.toContain("clawhub scan ./my-skill --output clawhub-scan.zip");
    expect(email.text).not.toContain("https://docs.openclaw.ai/clawhub/cli#scan-path");
  });

  it("does not leak raw manual moderator notes into outbound email", () => {
    const email = buildBanNotificationEmail({
      handle: "target",
      source: "manual",
      reason: "internal reviewer note: reporter=user_123 secret finding id=abc",
    });

    expect(email.context.findingSummary).toBe(
      "ClawHub staff disabled the account after a security review.",
    );
    expect(email.text).not.toContain("internal reviewer note");
    expect(email.text).not.toContain("reporter=user_123");
    expect(email.html).not.toContain("secret finding id");
  });

  it("uses rate-limit copy without scan remediation guidance", () => {
    const email = buildBanNotificationEmail({
      handle: "publish-loop",
      source: "manual",
      reason: "rate limit triggered by automated CLI publishing",
    });

    expect(email.context).toMatchObject({
      scannerLabel: null,
      findingSummary: "Publishing automation triggered ClawHub rate-limit abuse controls.",
    });
    expect(email.text).toContain("Publishing automation");
    expect(email.text).not.toContain("clawhub scan");
    expect(email.text).not.toContain("Include scan results");
    expect(email.html).not.toContain("Include scan results");
    expect(email.html).not.toContain("fixed local copy");
  });

  it("builds restored-account copy that explains tokens stay revoked", () => {
    const email = buildRestoredAccountEmail({
      handle: "restored",
      restoredListings: [
        { kind: "skill", name: "safe-one" },
        { kind: "plugin", name: "@scope/demo" },
      ],
    });

    expect(email.subject).toBe("Your ClawHub account was restored");
    expect(email.text).toContain("Your ClawHub account can sign in again.");
    expect(email.text).toContain("Skill: safe-one");
    expect(email.text).toContain("Plugin: @scope/demo");
    expect(email.text).toContain("Previously revoked API tokens stay revoked.");
  });

  it("builds malicious artifact copy without account appeal language", () => {
    const email = buildMaliciousArtifactEmail({
      handle: "publisher",
      artifact: { kind: "skill", name: "demo-skill" },
      version: "1.2.3",
      trigger: "malicious.llm_malicious",
      findingSummary: "Attempts to exfiltrate credentials.",
    });

    expect(email.subject).toBe("ClawHub blocked a skill version");
    expect(email.text).toContain("Reason: Attempts to exfiltrate credentials.");
    expect(email.html).toContain("Attempts to exfiltrate credentials.");
    expect(email.text).toContain("Skill: demo-skill");
    expect(email.text).toContain("Version: 1.2.3");
    expect(email.text).toContain("clawhub scan download demo-skill --version 1.2.3");
    expect(email.text).toContain("Increment the version number before uploading the fixed skill.");
    expect(email.text).toContain("https://docs.openclaw.ai/clawhub/moderation");
    expect(email.text).not.toContain("clawhub scan ./my-skill --output clawhub-scan.zip");
    expect(email.text).not.toContain("fixed local copy");
    expect(email.text).toContain("Repeated malicious rejections may lead to account disablement");
    expect(email.html).toContain("Repeated malicious rejections may lead to account disablement");
    expect(email.text).not.toContain(APPEALS_URL);
    expect(email.html).not.toContain(APPEALS_URL);
    expect(email.html).not.toContain("appeal this decision");
  });

  it("falls back to generic malicious artifact copy when no ClawScan summary is available", () => {
    const email = buildMaliciousArtifactEmail({
      handle: "publisher",
      artifact: { kind: "skill", name: "demo-skill" },
      version: "1.2.3",
      trigger: "malicious.llm_malicious",
    });

    expect(email.text).toContain("Reason: ClawScan classified the uploaded artifact as malicious.");
  });

  it("keeps supplied ClawScan summaries to one email-safe line", () => {
    const email = buildMaliciousArtifactEmail({
      handle: "publisher",
      artifact: { kind: "skill", name: "demo-skill" },
      version: "1.2.3",
      findingSummary: `  ${"credential exfiltration ".repeat(30)}\nwith hidden tooling  `,
    });

    const reasonLine = email.text.split("\n").find((line) => line.startsWith("Reason: "));
    expect(reasonLine).toBeDefined();
    expect(reasonLine).not.toContain("\n");
    expect(reasonLine?.length).toBeLessThanOrEqual("Reason: ".length + 280);
    expect(reasonLine).toContain("...");
  });

  it("builds plugin scan download copy with an explicit artifact kind", () => {
    const email = buildMaliciousArtifactEmail({
      handle: "publisher",
      artifact: { kind: "plugin", name: "@scope/demo" },
      version: "2.0.0",
      trigger: "malicious.static",
    });

    expect(email.text).toContain("Plugin: @scope/demo");
    expect(email.text).toContain("clawhub scan download @scope/demo --version 2.0.0 --kind plugin");
    expect(email.text).toContain("Increment the version number before uploading the fixed plugin.");
  });

  it("builds plugin inspector warning copy with local validation guidance", () => {
    const email = buildPackageInspectorFindingsEmail({
      packageName: "demo-plugin",
      version: "1.0.0",
      warningUrl: "https://clawhub.ai/plugins/demo-plugin#validation",
      findings: [
        {
          findingKind: "warning",
          code: "legacy-before-agent-start",
          issueClass: "deprecation-warning",
          severity: "P2",
          message: "legacy before_agent_start hook is deprecated",
          inspectorVersion: "0.4.0",
          targetOpenClawVersion: "0.9.0",
          scanSource: "publish",
        },
      ],
    });

    expect(email.subject).toBe("Plugin Inspector findings for demo-plugin@1.0.0");
    expect(email.text).toContain("We found issues with version 1.0.0 of demo-plugin.");
    expect(email.text).toContain(
      "The findings are warnings for the target OpenClaw version shown below.",
    );
    expect(email.text).toContain("Run the validation command locally against your plugin changes.");
    expect(email.text).toContain("clawhub package validate <path-to-plugin>");
    expect(email.text).toContain("WARNING legacy-before-agent-start (deprecation-warning) P2");
    expect(email.html).toContain("Validate a local fix");
    expect(email.html).toContain("clawhub package validate &lt;path-to-plugin&gt;");
    expect(email.html).toContain("plugin validation findings");
    expect(email.html).not.toContain("Your plugin was published");
    expect(email.html).not.toContain("published successfully");
  });

  it("builds plugin inspector error copy without publish-time wording", () => {
    const email = buildPackageInspectorFindingsEmail({
      packageName: "demo-plugin",
      version: "1.0.1",
      warningUrl: "https://clawhub.ai/plugins/demo-plugin#validation",
      findings: [
        {
          findingKind: "error",
          code: "missing-expected-seam",
          issueClass: "compatibility-error",
          severity: "P0",
          level: "breakage",
          message: "registerTool is no longer available",
          inspectorVersion: "0.5.0",
          targetOpenClawVersion: "0.10.0",
          scanSource: "nightly",
        },
      ],
    });

    expect(email.text).toContain("We found issues with version 1.0.1 of demo-plugin.");
    expect(email.text).toContain(
      "Some findings are errors for the target OpenClaw version shown below.",
    );
    expect(email.text).toContain("Run the validation command locally against your plugin changes.");
    expect(email.text).toContain("clawhub package validate <path-to-plugin>");
    expect(email.text).not.toContain("Your plugin was published");
    expect(email.text).not.toContain("was published, but");
    expect(email.text).not.toContain("nightly");
    expect(email.html).toContain("ERROR missing-expected-seam (compatibility-error) P0");
  });
});
