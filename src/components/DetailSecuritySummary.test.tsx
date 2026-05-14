/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { DetailSecuritySummary } from "./DetailSecuritySummary";

function renderSummary(element: ReactElement) {
  return render(element);
}

describe("DetailSecuritySummary", () => {
  it("shows scanner signals in the compact security audit row", () => {
    renderSummary(<DetailSecuritySummary scannerBasePath="/steipete/weather/security" />);

    expect(screen.getByRole("heading", { name: "Audits" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "VirusTotal: Pending" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "ClawScan: Pending" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Static analysis: Pending" })).toBeTruthy();
    expect(screen.queryByText("Pass")).toBeNull();
    expect(
      screen
        .getAllByRole("link")
        .filter((link) => link.className.includes("security-audit-signal"))
        .map((link) => link.getAttribute("aria-label")),
    ).toEqual(["ClawScan: Pending", "Static analysis: Pending", "VirusTotal: Pending"]);
  });

  it("shows staff-cleared public scan summaries as cleared", () => {
    renderSummary(
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
    expect(screen.queryByText("Warn")).toBeNull();
  });

  it("shows review and warn as separate audit states", () => {
    const { rerender } = renderSummary(
      <DetailSecuritySummary
        scannerBasePath="/steipete/weather/security"
        vtAnalysis={{ status: "clean", checkedAt: 1 }}
        llmAnalysis={{
          status: "suspicious",
          verdict: "suspicious",
          checkedAt: 1,
          agenticRiskFindings: [
            {
              categoryId: "ASI02",
              categoryLabel: "Tool Misuse and Exploitation",
              riskBucket: "abnormal_behavior_control",
              status: "concern",
              severity: "medium",
              confidence: "medium",
              evidence: {
                path: "SKILL.md",
                snippet: "uses privileged tool",
                explanation: "The skill uses a privileged tool.",
              },
              userImpact: "Needs context.",
              recommendation: "Review before install.",
            },
          ],
        }}
        staticScan={{
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "Clean.",
          engineVersion: "v1",
          checkedAt: 1,
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "ClawScan: Review" })).toBeTruthy();
    expect(screen.getAllByText("Review").length).toBeGreaterThan(0);

    rerender(
      <DetailSecuritySummary
        scannerBasePath="/steipete/weather/security"
        vtAnalysis={{ status: "clean", checkedAt: 1 }}
        llmAnalysis={{
          status: "suspicious",
          verdict: "suspicious",
          checkedAt: 1,
          agenticRiskFindings: [
            {
              categoryId: "ASI02",
              categoryLabel: "Tool Misuse and Exploitation",
              riskBucket: "abnormal_behavior_control",
              status: "concern",
              severity: "high",
              confidence: "high",
              evidence: {
                path: "SKILL.md",
                snippet: "terminates cloud instances",
                explanation: "The skill can terminate cloud instances.",
              },
              userImpact: "High concern.",
              recommendation: "Require confirmation.",
            },
          ],
        }}
        staticScan={{
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "Clean.",
          engineVersion: "v1",
          checkedAt: 1,
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "ClawScan: Warn" })).toBeTruthy();
    expect(screen.getAllByText("Warn").length).toBeGreaterThan(0);
    expect(screen.queryByText("Suspicious")).toBeNull();
  });

  it("renders clean scanner outcomes as pass in the user-facing audit UI", () => {
    renderSummary(
      <DetailSecuritySummary
        scannerBasePath="/steipete/weather/security"
        vtAnalysis={{ status: "clean", checkedAt: 1 }}
        llmAnalysis={{ status: "clean", checkedAt: 1 }}
        staticScan={{
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "Clean.",
          engineVersion: "v1",
          checkedAt: 1,
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "VirusTotal: Pass" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "ClawScan: Pass" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Static analysis: Pass" })).toBeTruthy();
    expect(screen.queryByText("Benign")).toBeNull();
  });

  it("renders VirusTotal AI-only advisory scans as pass", () => {
    renderSummary(
      <DetailSecuritySummary
        scannerBasePath="/tokauthai/skillscan/security"
        vtAnalysis={{
          status: "suspicious",
          source: "VirusTotal Code Insight",
          scanner: "code_insight",
          analysis: "AI-only advisory context.",
          checkedAt: 1,
        }}
        llmAnalysis={{ status: "clean", checkedAt: 1 }}
        staticScan={{
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "Clean.",
          engineVersion: "v1",
          checkedAt: 1,
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "VirusTotal: Pass" })).toBeTruthy();
    expect(screen.queryByText("Advisory")).toBeNull();
  });

  it("keeps VirusTotal tooltip previews aligned with the plain full-audit copy", async () => {
    renderSummary(
      <DetailSecuritySummary
        scannerBasePath="/pskoett/self-improving-agent/security"
        vtAnalysis={{
          status: "suspicious",
          source: "VirusTotal Code Insight",
          scanner: "code_insight",
          analysis:
            "Type: OpenClaw Skill Name: self-improving-agent Version: 1.0.0 ### Summary\nThe skill bundle implements a structured self-improvement framework for OpenClaw agents.",
          checkedAt: 1,
        }}
      />,
    );

    fireEvent.focus(screen.getByRole("link", { name: "VirusTotal: Pass" }));

    const preview = screen.getByRole("group", { name: "VirusTotal audit preview" });
    const overview = preview.querySelector(".security-audit-tooltip-overview");
    expect(overview?.textContent).toBe(
      "The skill bundle implements a structured self-improvement framework for OpenClaw agents.",
    );
    expect(overview?.textContent).not.toContain("Summary");
    expect(overview?.textContent).not.toContain("Type:");
  });

  it("shows a structured tooltip with truncated overview and full-audit CTA", async () => {
    renderSummary(
      <DetailSecuritySummary
        scannerBasePath="/steipete/weather/security"
        llmAnalysis={{
          status: "clean",
          checkedAt: 1,
          summary:
            "Line one overview for ClawScan.\nLine two keeps context visible for hover preview and should remain readable while still being trimmed to fit this compact tooltip.",
        }}
      />,
    );

    fireEvent.focus(screen.getByRole("link", { name: "ClawScan: Pass" }));

    const preview = screen.getByRole("group", { name: "ClawScan audit preview" });
    const overview = preview.querySelector(".security-audit-tooltip-overview");
    expect(overview).toBeTruthy();
    expect(overview?.textContent?.length ?? 0).toBeLessThanOrEqual(150);
    expect(overview?.textContent?.includes("\n")).toBe(true);
    const ctaLink = preview.querySelector(".security-audit-tooltip-action");
    expect(ctaLink?.getAttribute("href")).toBe("/steipete/weather/security/clawscan");
  });

  it("keeps the full-audit CTA keyboard-reachable from the preview trigger", () => {
    renderSummary(
      <DetailSecuritySummary
        scannerBasePath="/steipete/weather/security"
        llmAnalysis={{
          status: "clean",
          checkedAt: 1,
          summary: "Clean ClawScan preview.",
        }}
      />,
    );

    const trigger = screen.getByRole("link", { name: "ClawScan: Pass" });
    trigger.focus();

    const preview = screen.getByRole("group", { name: "ClawScan audit preview" });
    const ctaLink = preview.querySelector<HTMLAnchorElement>(".security-audit-tooltip-action");
    expect(ctaLink).toBeTruthy();

    ctaLink?.focus();
    expect(document.activeElement).toBe(ctaLink);
    expect(preview.contains(document.activeElement)).toBe(true);
    expect(ctaLink?.getAttribute("href")).toBe("/steipete/weather/security/clawscan");
  });

  it("shows static suspicious as review without rolling it up to suspicious", () => {
    renderSummary(
      <DetailSecuritySummary
        scannerBasePath="/steipete/weather/security"
        vtAnalysis={{ status: "clean", checkedAt: 1 }}
        llmAnalysis={{ status: "clean", checkedAt: 1 }}
        staticScan={{
          status: "suspicious",
          reasonCodes: ["suspicious.network_access"],
          findings: [],
          summary: "Static advisory finding.",
          engineVersion: "v1",
          checkedAt: 1,
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Static analysis: Review" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "ClawScan: Pass" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "VirusTotal: Pass" })).toBeTruthy();
    expect(screen.queryByText("Warn")).toBeNull();
  });

  it("does not aggregate scanner operational errors as malicious verdicts", () => {
    renderSummary(
      <DetailSecuritySummary
        scannerBasePath="/steipete/weather/security"
        vtAnalysis={{ status: "failed", checkedAt: 1 }}
        llmAnalysis={{ status: "clean", checkedAt: 1 }}
        staticScan={{
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "Clean.",
          engineVersion: "v1",
          checkedAt: 1,
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "VirusTotal: Error" })).toBeTruthy();
    expect(screen.getAllByText("Error").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Malicious")).toBeNull();
  });
});
