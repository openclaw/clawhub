/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DetailSecuritySummary } from "./DetailSecuritySummary";

describe("DetailSecuritySummary", () => {
  it("shows a disabled spinner button while a rescan is in progress", () => {
    render(
      <DetailSecuritySummary
        scannerBasePath="/steipete/weather/security"
        rescanState={{
          maxRequests: 3,
          requestCount: 1,
          remainingRequests: 2,
          canRequest: false,
          inProgressRequest: {
            _id: "rescanRequests:1",
            targetKind: "skill",
            targetVersion: "1.0.0",
            status: "in_progress",
            createdAt: 1,
            updatedAt: 1,
          },
          latestRequest: null,
        }}
        onRequestRescan={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Scanning" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("A rescan is already in progress.");
    expect(button.querySelector(".animate-spin")?.className).toContain(
      "[animation-duration:2.4s]",
    );
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
