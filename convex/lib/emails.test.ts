import { describe, expect, it } from "vitest";
import {
  APPEALS_URL,
  OPENCLAW_DISCORD_URL,
  buildAdminOneOffEmail,
  buildBanNotificationEmail,
  buildMaliciousArtifactEmail,
  buildPackageInspectorFindingsEmail,
  buildPublisherAbuseWarningEmail,
  buildRestoredAccountEmail,
} from "./emails";

function expectFooterLinksUnderlined(html: string) {
  expect(html).toMatch(
    /href="https:\/\/clawhub\.ai"[^>]*style="[^"]*color:#8a8a8e[^"]*text-decoration[^"]*underline[^"]*"[^>]*>ClawHub<\/a>/,
  );
  expect(html).toMatch(
    /href="https:\/\/(?:clawhub\.ai\/docs|docs\.openclaw\.ai\/clawhub)"[^>]*style="[^"]*color:#8a8a8e[^"]*text-decoration[^"]*underline[^"]*"[^>]*>Docs<\/a>/,
  );
}

describe("moderation notification email copy", () => {
  it("builds public-safe malicious skill context with appeal but no local scan guidance", async () => {
    const email = await buildBanNotificationEmail({
      handle: "gingiris",
      source: "autoban",
      reason: "malicious.llm_malicious",
      artifact: { kind: "skill", name: "gingiris-launch" },
      trigger: "scanner.llm.malicious",
    });

    expect(email.subject).toBe("Your ClawHub account has been suspended");
    expect(email.context).toMatchObject({
      appealUrl: APPEALS_URL,
      artifact: { kind: "skill", name: "gingiris-launch" },
      scannerLabel: "ClawScan",
      findingSummary: "ClawScan classified the uploaded skill as malicious.",
    });
    expect(email.text).toContain("Skill: gingiris-launch");
    expect(email.text).not.toContain("Scanner:");
    expect(email.html).toContain("background-color:#0a0a0b");
    expect(email.html).toContain("ClawHub");
    expect(email.html).toMatch(
      /<p[^>]*>ClawScan classified the uploaded skill as malicious\.<\/p>/,
    );
    expect(email.html).toMatch(/<li[^>]*>Your ClawHub account cannot sign in\.<\/li>/);
    expect(email.html).toMatch(
      /<li[^>]*>Existing API tokens for the account have been revoked\.<\/li>/,
    );
    expect(email.html).toMatch(
      /<li[^>]*>Published listings owned by the account may be hidden from public view\.<\/li>/,
    );
    expect(email.html).not.toContain("<strong>Scanner:</strong>");
    expect(email.text).not.toContain("republishing");
    expect(email.html).not.toContain("republishing");
    expect(email.text).not.toContain("To support your appeal, include scan results");
    expect(email.html).not.toContain("Include scan results with your appeal");
    expect(email.text).toContain("Appeal: https://appeals.openclaw.ai/");
    expect(email.html).not.toContain("If you already appealed");
    expect(email.html).not.toContain("separate support email");
    expect(email.html).not.toContain("You received this email because");
    expect(email.html).toContain("https://docs.openclaw.ai/clawhub");
    expectFooterLinksUnderlined(email.html);
    expect(email.text).not.toContain("clawhub scan ./my-skill --output clawhub-scan.zip");
    expect(email.text).not.toContain("https://docs.openclaw.ai/clawhub/cli#scan-path");
  });

  it("does not leak raw manual moderator notes into outbound email", async () => {
    const email = await buildBanNotificationEmail({
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

  it("uses rate-limit copy without scan remediation guidance", async () => {
    const email = await buildBanNotificationEmail({
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

  it("builds publisher-abuse account-suspended copy from a structured manual reason", async () => {
    const email = await buildBanNotificationEmail({
      handle: "bulkpub",
      source: "manual",
      reason: "publisher_abuse: high catalog volume, low installs per skill, abnormal downloads",
      hiddenArtifacts: 42,
    });

    expect(email.subject).toBe("Your ClawHub account has been suspended");
    expect(email.context).toMatchObject({
      appealUrl: APPEALS_URL,
      artifact: null,
      scannerLabel: null,
      findingSummary:
        "Your account was identified by ClawHub's publisher abuse review workflow for activity that appears inconsistent with our Acceptable Usage policy.",
    });
    expect(email.text).toContain("Hi bulkpub,");
    expect(email.text).toContain("Bulk or spam publishing");
    expect(email.text).toContain("Artificially inflating installs, downloads, stars");
    expect(email.text).toContain(
      "Abnormal download activity with little or no corresponding install activity",
    );
    expect(email.text).toContain("Artifacts hidden");
    expect(email.text).not.toContain("publisher_abuse:");
    expect(email.text).toContain(`Appeal: ${APPEALS_URL}`);
    expect(email.html).toContain("Submit an appeal");
    expect(email.html).toContain("Bulk or spam publishing");
    expect(email.html).toContain("Artificially inflating installs, downloads, stars");
    expect(email.html).toContain("Artifacts hidden");
    expect(email.html).not.toContain("publisher_abuse:");
  });

  it("uses publisher-abuse copy for automated publisher-abuse bans", async () => {
    const email = await buildBanNotificationEmail({
      handle: "bulkpub",
      source: "autoban",
      reason: "publisher_abuse: potential ban candidate",
      trigger: "publisher_abuse",
    });

    expect(email.context).toMatchObject({
      scannerLabel: null,
      findingSummary:
        "Your account was identified by ClawHub's publisher abuse review workflow for activity that appears inconsistent with our Acceptable Usage policy.",
    });
    expect(email.text).toContain("Bulk or spam publishing");
    expect(email.text).toContain(`Appeal: ${APPEALS_URL}`);
    expect(email.text).not.toContain("ClawHub security checks classified the uploaded skill");
  });

  it("builds restored-account copy that explains tokens stay revoked", async () => {
    const email = await buildRestoredAccountEmail({
      handle: "restored",
      restoredListings: [
        { kind: "skill", name: "safe-one" },
        { kind: "plugin", name: "@scope/demo" },
      ],
    });

    expect(email.subject).toBe("Your ClawHub account has been reinstated");
    expect(email.text).toContain("Your ClawHub account can sign in again.");
    expect(email.text).toContain("Skill: safe-one");
    expect(email.text).toContain("Plugin: @scope/demo");
    expect(email.text).toContain("Previously revoked API tokens stay revoked.");
    expect(email.html).toContain("ACCOUNT REINSTATED");
    expect(email.html).toContain("API tokens issued before the suspension");
    expect(email.html).not.toContain("You received this email because");
    expect(email.html).toContain("https://docs.openclaw.ai/clawhub");
    expectFooterLinksUnderlined(email.html);
  });

  it("omits restored count rows when batch totals are not complete", async () => {
    const email = await buildRestoredAccountEmail({
      handle: "restored",
      restoredAt: 1_700_000_000_000,
      skillsRestored: 5,
      packagesRestored: undefined,
    });

    expect(email.html).not.toContain("Skills restored");
    expect(email.html).not.toContain("Packages restored");
    expect(email.html).not.toContain(">12<");
    expect(email.html).not.toContain(">3<");
    expect(email.html).toContain("Your account is active again.");
  });

  it("builds malicious artifact copy without account appeal language", async () => {
    const email = await buildMaliciousArtifactEmail({
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
    expect(email.html).toContain("Skill Review");
    expect(email.html).not.toContain("Plugin Review");
    expect(email.html).toContain("ClawHub blocked a skill version");
    expect(email.html).not.toContain("Open ClawHub");
    expect(email.html).not.toContain('href="https://clawhub.ai" style="display:inline-block');
    expect(email.text).not.toContain(APPEALS_URL);
    expect(email.html).not.toContain(APPEALS_URL);
    expect(email.html).not.toContain("appeal this decision");
  });

  it("falls back to generic malicious artifact copy when no ClawScan summary is available", async () => {
    const email = await buildMaliciousArtifactEmail({
      handle: "publisher",
      artifact: { kind: "skill", name: "demo-skill" },
      version: "1.2.3",
      trigger: "malicious.llm_malicious",
    });

    expect(email.text).toContain("Reason: ClawScan classified the uploaded artifact as malicious.");
  });

  it("keeps supplied ClawScan summaries to one email-safe line", async () => {
    const email = await buildMaliciousArtifactEmail({
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

  it("builds plugin scan download copy with an explicit artifact kind", async () => {
    const email = await buildMaliciousArtifactEmail({
      handle: "publisher",
      artifact: { kind: "plugin", name: "@scope/demo" },
      version: "2.0.0",
      trigger: "malicious.static",
    });

    expect(email.text).toContain("Plugin: @scope/demo");
    expect(email.text).toContain("clawhub scan download @scope/demo --version 2.0.0 --kind plugin");
    expect(email.text).toContain("Increment the version number before uploading the fixed plugin.");
  });

  it("builds plugin inspector warning copy with local validation guidance", async () => {
    const email = await buildPackageInspectorFindingsEmail({
      handle: "octocat",
      packageName: "demo-plugin",
      version: "1.0.0",
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
          authorRemediation: {
            summary: "Replace the legacy before_agent_start hook with current prompt hooks.",
            docsUrl:
              "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#legacy-before-agent-start",
          },
        },
      ],
    });

    expect(email.subject).toBe("Plugin Inspector findings for demo-plugin@1.0.0");
    expect(email.text).toContain("Hi octocat,");
    expect(email.text).toContain("We found 1 issue with version 1.0.0 of demo-plugin.");
    expect(email.text).toContain("OpenClaw Version: 0.9.0");
    expect(email.text).toContain("Address the findings below in your plugin package.");
    expect(email.text).toContain("Run the validation command locally against your changes.");
    expect(email.text).toContain("clawhub package validate <path-to-plugin>");
    expect(email.text).toContain(
      "- **WARNING** `legacy-before-agent-start` (deprecation-warning, P2)",
    );
    expect(email.text).toContain("  legacy before_agent_start hook is deprecated");
    expect(email.text).toContain("  Fix:");
    expect(email.text).toContain(
      "  Replace the legacy before_agent_start hook with current prompt hooks.",
    );
    expect(email.text).toContain("  Docs:");
    expect(email.text).toContain(
      "  https://docs.openclaw.ai/clawhub/plugin-validation-fixes#legacy-before-agent-start",
    );
    expect(email.text).not.toContain("ClawHub Security");
    expect(email.html).toContain("Validate a local fix");
    expect(email.html).toContain("Plugin Review");
    expect(email.html).not.toContain("Open ClawHub");
    expect(email.html).not.toContain('href="https://clawhub.ai" style="display:inline-block');
    expect(email.html).not.toContain("You&#39;re receiving this because");
    expect(email.html).not.toContain("You're receiving this because");
    expect(email.html).toContain("https://docs.openclaw.ai");
    expectFooterLinksUnderlined(email.html);
    expect(email.html).toContain("OpenClaw Version");
    expect(email.html).toContain("0.9.0");
    expect(email.html).toContain("clawhub package validate &lt;path-to-plugin&gt;");
    expect(email.html).toContain("legacy-before-agent-start");
    expect(email.html).toContain("legacy-before-agent-start · deprecation-warning · P2");
    expect(email.html).toContain("Fix");
    expect(email.html).toContain("Replace the legacy before_agent_start hook");
    expect(email.html).toContain("Docs →");
    expect(email.html).toContain("plugin-validation-fixes#legacy-before-agent-start");
    expect(email.html).not.toContain("plugin validation fix docs");
    expect(email.html).not.toContain("ClawHub Security");
    expect(email.text).not.toContain("Plugin Inspector: 0.4.0");
    expect(email.text).not.toContain("Target OpenClaw:");
    expect(email.html).not.toContain("<strong>Plugin Inspector:</strong>");
    expect(email.html).not.toContain("<strong>Target OpenClaw:</strong>");
    expect(email.html).not.toContain("Review:");
    expect(email.html).not.toContain("plugin validation findings");
    expect(email.html).not.toContain("https://clawhub.ai/plugins/demo-plugin#validation");
    expect(email.html).not.toContain("Your plugin was published");
    expect(email.html).not.toContain("published successfully");
  });

  it("builds plugin inspector error copy without publish-time wording", async () => {
    const email = await buildPackageInspectorFindingsEmail({
      packageName: "demo-plugin",
      version: "1.0.1",
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

    expect(email.text).toContain("We found 1 issue with version 1.0.1 of demo-plugin.");
    expect(email.text).toContain("Address the findings below in your plugin package.");
    expect(email.text).toContain("Run the validation command locally against your changes.");
    expect(email.text).toContain("clawhub package validate <path-to-plugin>");
    expect(email.text).toContain("- **ERROR** `missing-expected-seam` (compatibility-error, P0)");
    expect(email.text).not.toContain("Your plugin was published");
    expect(email.text).not.toContain("was published, but");
    expect(email.text).not.toContain("Some findings are errors");
    expect(email.text).not.toContain("nightly");
    expect(email.html).toContain("missing-expected-seam");
    expect(email.html).toContain("compatibility-error · P0");
  });

  it("does not rewrite inserted package names, versions, or issue counts", async () => {
    const findings = Array.from({ length: 11 }, (_, index) => ({
      findingKind: "warning" as const,
      code: `finding-${index + 1}`,
      issueClass: "compatibility-warning",
      severity: "P2",
      message: "review finding",
    }));
    const email = await buildPackageInspectorFindingsEmail({
      packageName: "my-demo-plugin",
      version: "1.0.0-beta",
      findings,
    });

    expect(email.text).toContain("We found 11 issues with version 1.0.0-beta of my-demo-plugin.");
    expect(email.html).toContain("11 issues found");
    expect(email.html).toContain("my-demo-plugin@1.0.0-beta");
    expect(email.html).not.toContain("my-my-demo-plugin");
    expect(email.html).not.toContain("1.0.0-beta-beta");
    expect(email.html).not.toContain("11 issueses");
  });

  it("builds publisher abuse warning emails with a deadline and Discord maintainer escalation", async () => {
    const email = await buildPublisherAbuseWarningEmail({
      handle: "bulkpub",
      publisherHandle: "bulkpub",
      warningSentAt: Date.UTC(2026, 5, 19, 4, 0, 0),
      deadlineAt: Date.UTC(2026, 5, 26, 4, 0, 0),
      score: {
        modelVersion: "publisher-abuse-pressure.v2",
        publishedSkills: 143,
        totalInstalls: 2,
        totalStars: 0,
        totalDownloads: 30,
        installsPerSkill: 0.01,
        starsPerSkill: 0,
        downloadsPerSkill: 0.21,
        zScore: 3.2,
        reasonCodes: ["high_catalog_volume", "low_installs_per_skill"],
      },
    });

    expect(email.subject).toBe("Action required: ClawHub publisher abuse warning");
    expect(email.text).toContain("Hi bulkpub,");
    expect(email.text).toContain(
      "ClawHub's publisher abuse detection flagged the publisher profile @bulkpub.",
    );
    expect(email.text).toContain("Deadline: 2026-06-26 04:00:00 UTC");
    expect(email.text).toContain("Delete low-quality, duplicate, placeholder");
    expect(email.text).toContain(
      `For more information, join the OpenClaw Discord and tag one of the maintainers: ${OPENCLAW_DISCORD_URL}`,
    );
    expect(email.text).not.toContain("Current signals:");
    expect(email.text).not.toContain("Published skills");
    expect(email.text).not.toContain("Total installs");
    expect(email.text).not.toContain("Installs per skill");
    expect(email.text).not.toContain("Why this triggered:");
    expect(email.text).not.toContain("High Catalog Volume");
    expect(email.text).not.toContain("Low Installs Per Skill");
    expect(email.html).toContain("Action required: publisher abuse warning");
    expect(email.html).toContain("@bulkpub");
    expect(email.html).toContain("2026-06-26 04:00:00 UTC");
    expect(email.html).toContain(OPENCLAW_DISCORD_URL);
  });

  it("builds a templated admin one-off email with escaped staff-authored content", async () => {
    const email = await buildAdminOneOffEmail({
      recipientHandle: "octocat",
      subject: "Content rights report",
      title: "Action required: content rights report",
      body: "We received a report about <package>. Please reply with context.",
      primaryActionLabel: "Open appeal",
      primaryActionUrl: "https://appeals.openclaw.ai/case-123",
    });

    expect(email.subject).toBe("Content rights report");
    expect(email.text).not.toContain("Hi octocat,");
    expect(email.text).toContain("Action required: content rights report");
    expect(email.text.indexOf("Action required: content rights report")).toBeLessThan(
      email.text.indexOf("We received a report"),
    );
    expect(email.text).toContain("Open appeal: https://appeals.openclaw.ai/case-123");
    expect(email.html).toContain("font-size:18px");
    expect(email.html).toContain("ClawHub");
    expect(email.html).toContain("Action required: content rights report");
    expect(email.html).not.toContain("Hi octocat");
    expect(email.html).toContain("We received a report about &lt;package&gt;.");
    expect(email.html).toContain("Open appeal");
    expect(email.html).not.toContain("<package>");
    expect(email.html).not.toContain("You received this email because");
    expect(email.html).toContain("https://docs.openclaw.ai/clawhub");
    expectFooterLinksUnderlined(email.html);
  });

  it("omits the admin one-off button when no action is provided", async () => {
    const email = await buildAdminOneOffEmail({
      recipientHandle: "octocat",
      subject: "Content rights report",
      title: "Action required: content rights report",
      body: "We received a report about <package>. Please reply with context.",
    });

    expect(email.text).not.toContain("Open ClawHub:");
    expect(email.html).toContain("Action required: content rights report");
    expect(email.html).not.toContain("Open ClawHub");
    expect(email.html).not.toContain("{{primary_action_label}}");
    expect(email.html).not.toContain("{{primary_action_url}}");
    expect(email.html).not.toContain('href="https://clawhub.ai" style="display:inline-block');
    expect(email.html).not.toContain("You received this email because");
    expect(email.html).toContain("https://docs.openclaw.ai/clawhub");
    expectFooterLinksUnderlined(email.html);
  });
});
