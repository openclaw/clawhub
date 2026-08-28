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
