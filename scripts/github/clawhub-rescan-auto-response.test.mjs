/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  RESCAN_GUIDANCE_COMMENT_MARKER,
  RESCAN_GUIDANCE_LABEL,
  SUPPRESS_LABEL,
  classifyRescanRequest,
  planCommentForLabeledIssue,
  planIssue,
  rescanGuidanceComment,
} from "./clawhub-rescan-auto-response.mjs";

const issue = (overrides) => ({
  number: 1,
  title: "placeholder",
  body: "",
  state: "OPEN",
  url: "https://github.com/openclaw/clawhub/issues/1",
  labels: [],
  ...overrides,
});

describe("clawhub rescan auto-response classifier", () => {
  it.each([
    [
      1553,
      "Re-scan jarviyin/clawpk v5.0.0 - remove suspicious flag",
      "Please re-run the security scan on v5.0.0 and remove the suspicious flag. The package no longer contains any patterns that should trigger it.",
    ],
    [
      1834,
      "feishu-team-manager: Request re-scan after fixing flagged issues (v2.4.3)",
      "The skill fixed credentials and Unicode control characters. Please re-run the security scan on v2.4.3.",
    ],
    [
      1808,
      "Re-evaluation request: topview-skill (official Topview AI client) - medium-suspicious verdict triggered by emoji ZWJ false positive",
      "Please re-scan at the current commit and reclassify as Benign. The suspicious scan findings have been fixed.",
    ],
    [
      1671,
      'Request for Security Re-evaluation: "book-companion" skill marked as suspicious',
      "I have proactively audited the skill and implemented compliance measures. Please review the updated documentation and clear the suspicious flag.",
    ],
    [
      758,
      "False positive: create-project skill flagged as suspicious by VirusTotal",
      "The create-project skill has been flagged as suspicious. This appears to be the same class of false positive as other issues.",
    ],
    [
      256,
      "False positive: clawarr-suite flagged as suspicious",
      "Please review and unflag this plugin. All patterns are standard for a media server management tool.",
    ],
    [
      1901,
      "Suspicious flag on my skill",
      "The current version is still flagged as suspicious after the metadata update.",
    ],
    [
      1902,
      "Skill flagged as suspicious",
      "This skill should be clean now. Please tell me how to clear the flag.",
    ],
    [1903, "supicious flag on plugin", "The plugin is incorrectly flagged and needs a fresh scan."],
  ])("matches explicit rescan/re-evaluation request #%s", (number, title, body) => {
    const result = classifyRescanRequest(issue({ number, title, body }));

    expect(result.matched).toBe(true);
    expect(result.matchedRules.length).toBeGreaterThanOrEqual(3);
    expect(result.actions).toEqual([{ type: "add_label", label: RESCAN_GUIDANCE_LABEL }]);
    expect(rescanGuidanceComment).toContain(RESCAN_GUIDANCE_COMMENT_MARKER);
  });

  it.each([
    [
      589,
      "Rate limit exceeded when installing clawhub",
      "npx clawhub@latest install sonoscli returns Rate limit exceeded. Is this not getting fixed?",
    ],
    [
      100,
      "CLI: Auth fails due to redirect from clawhub.ai to www.clawhub.ai",
      "The clawhub CLI fails to authenticate because a redirect loses the Authorization header.",
    ],
    [
      1514,
      "False duplicate flag: claude-to-free is not a duplicate of model-migration",
      "This skill is not a duplicate. Please remove the duplicate flag.",
    ],
    [
      1904,
      "False positive: search result disappeared",
      "My skill vanished from search results after publishing the latest version.",
    ],
  ])("does not match non-rescan issue #%s", (number, title, body) => {
    const result = classifyRescanRequest(issue({ number, title, body }));

    expect(result.matched).toBe(false);
    expect(result.actions).toEqual([]);
  });

  it("skips closed issues", () => {
    const result = classifyRescanRequest(
      issue({
        state: "CLOSED",
        title: "Re-scan example skill",
        body: "Please re-run the security scan and remove the suspicious flag.",
      }),
    );

    expect(result.matched).toBe(false);
    expect(result.reason).toContain("closed");
  });

  it("skips pull requests", () => {
    const result = classifyRescanRequest(
      issue({
        isPullRequest: true,
        title: "Re-scan example skill",
        body: "Please re-run the security scan and remove the suspicious flag.",
      }),
    );

    expect(result.matched).toBe(false);
    expect(result.reason).toContain("pull request");
  });

  it("skips suppressed and already-handled issues", () => {
    expect(
      classifyRescanRequest(
        issue({
          labels: [{ name: SUPPRESS_LABEL }],
          title: "Re-scan example skill",
          body: "Please re-run the security scan and remove the suspicious flag.",
        }),
      ).reason,
    ).toContain(SUPPRESS_LABEL);

    expect(
      classifyRescanRequest(
        issue({
          labels: [{ name: RESCAN_GUIDANCE_LABEL }],
          title: "Re-scan example skill",
          body: "Please re-run the security scan and remove the suspicious flag.",
        }),
      ).reason,
    ).toContain(RESCAN_GUIDANCE_LABEL);
  });

  it("plans dry-run rows for matched issues", () => {
    const plan = planIssue(
      issue({
        number: 1834,
        title: "feishu-team-manager: Request re-scan after fixing flagged issues (v2.4.3)",
        body: "This skill has fixed flagged metadata issues. Please re-run the security scan on v2.4.3.",
      }),
    );

    expect(plan).toMatchObject({
      number: 1834,
      matched: true,
      actions: [{ type: "add_label", label: RESCAN_GUIDANCE_LABEL }],
    });
  });

  it("plans comments only for issues already labeled for guidance", () => {
    const plan = planCommentForLabeledIssue(
      issue({
        labels: [{ name: RESCAN_GUIDANCE_LABEL }],
        title: "False positive: example skill flagged as suspicious",
        body: "Please re-run the security scan.",
      }),
    );

    expect(plan).toMatchObject({
      matched: true,
      matchedRules: ["rescan-guidance-label"],
      actions: [
        {
          type: "comment",
          body: rescanGuidanceComment,
          bodySha256: expect.any(String),
        },
        {
          type: "close",
          stateReason: "not_planned",
        },
      ],
    });
    expect(rescanGuidanceComment).toContain("reopen this issue");
  });

  it("does not plan comments without the guidance label", () => {
    const plan = planCommentForLabeledIssue(
      issue({
        title: "False positive: example skill flagged as suspicious",
        body: "Please re-run the security scan.",
      }),
    );

    expect(plan).toMatchObject({
      matched: false,
      actions: [],
    });
  });
});
