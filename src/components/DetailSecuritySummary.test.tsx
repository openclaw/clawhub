/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DetailSecuritySummary } from "./DetailSecuritySummary";

describe("DetailSecuritySummary", () => {
  it("shows scanner signals in the compact security audit row", () => {
    render(<DetailSecuritySummary scannerBasePath="/steipete/weather/security" />);

    expect(screen.getByRole("heading", { name: "Audits" })).toBeTruthy();
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "VirusTotal: Pending" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "ClawScan: Pending" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Static analysis: Pending" })).toBeTruthy();
  });

  it("shows staff-cleared public scan summaries as cleared", () => {
    render(
      <DetailSecuritySummary
        scannerBasePath="/suka233/kmind-markdown-to-mindmap/security"
        vtAnalysis={{ status: "suspicious", verdict: "suspicious", checkedAt: 1 }}
        llmAnalysis={{ status: "suspicious", verdict: "suspicious", checkedAt: 1 }}
        staticScan={{
          status: "suspicious",
          reasonCodes: ["suspicious.dynamic_code_execution"],
          findings: [
            {
              code: "suspicious.dynamic_code_execution",
              severity: "critical",
              file: "SKILL.md",
              line: 1,
              message: "dynamic execution",
              evidence: "exec",
            },
          ],
          summary: "Suspicious dynamic execution.",
          engineVersion: "v2.4.5",
          checkedAt: 1,
        }}
        suppressScanResults
        suppressedMessage="Security findings on these releases were reviewed by staff and cleared for public use."
      />,
    );

    expect(screen.getByText(/reviewed by staff and cleared/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /VirusTotal.*Cleared/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /ClawScan.*Cleared/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Static analysis.*Cleared/i })).toBeTruthy();
    expect(screen.queryByText("Suspicious")).toBeNull();
  });
});
