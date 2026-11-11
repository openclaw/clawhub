import { describe, expect, it } from "vitest";
import { formatSecurityAuditOverview, getSecurityAuditOverviewCopy } from "./securityAudit.js";

describe("security audit overview", () => {
  it("formats the canonical summary and guidance copy", () => {
    const input = {
      llmAnalysis: {
        summary: "  ClawScan clean.  ",
        guidance: "  Use least-privileged credentials.  ",
      },
    };

    expect(getSecurityAuditOverviewCopy(input)).toEqual([
      "ClawScan clean.",
      "Use least-privileged credentials.",
    ]);
    expect(formatSecurityAuditOverview(input)).toBe(
      "ClawScan clean.\n\nUse least-privileged credentials.",
    );
  });
});

it.each(["benign", "suspicious", "malicious"])(
  "does not invent an overview or hide a completed %s verdict",
  (verdict) => {
    expect(getSecurityAuditOverviewCopy({ llmAnalysis: { verdict } })).toEqual([
      "No overview is available for this completed security scan.",
    ]);
  },
);
it("distinguishes scanner failure from an unrecorded analysis", () => {
  expect(getSecurityAuditOverviewCopy({ llmAnalysis: { status: "failed" } })).toEqual([
    "The security scan failed. No overview is available.",
  ]);
  expect(getSecurityAuditOverviewCopy({})).toEqual(["No security analysis has been recorded yet."]);
});
