/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DetailSecuritySummary } from "./DetailSecuritySummary";

describe("DetailSecuritySummary", () => {
  it("shows the audit verdict and full audit link in the compact sidebar row", () => {
    render(
      <DetailSecuritySummary
        auditHref="/steipete/weather/security-audit"
        vtAnalysis={{ status: "clean", checkedAt: 1 }}
        llmAnalysis={{
          status: "clean",
          summary: "ClawScan found the declared purpose aligned with the artifact.",
          guidance: "Install from publishers you trust.",
          checkedAt: 1,
        }}
      />,
    );

    expect(screen.getByText("Pass")).toBeTruthy();
    const auditLink = screen.getByRole("link", { name: "View Security Audit" });
    expect(auditLink.getAttribute("href")).toBe("/steipete/weather/security-audit");
    expect(auditLink.getAttribute("target")).toBeNull();
    expect(auditLink.getAttribute("rel")).toBeNull();
    expect(
      screen.queryByText("ClawScan found the declared purpose aligned with the artifact."),
    ).toBeNull();
    expect(screen.queryByText("Install from publishers you trust.")).toBeNull();
    expect(screen.queryByRole("link", { name: /VirusTotal/i })).toBeNull();
    expect(
      screen.queryByText("Security checks across malware telemetry and agentic risk"),
    ).toBeNull();
    expect(document.querySelector(".security-audit-meter")?.getAttribute("data-level")).toBe("4");
    expect(document.querySelectorAll(".security-audit-meter span")).toHaveLength(4);
  });

  it("renders GitHub-backed scan status when no version-backed scan exists", () => {
    render(
      <DetailSecuritySummary
        auditHref="/nvidia/aiq-deploy/security-audit"
        githubScanStatus="pending"
      />,
    );

    expect(screen.getByText("Pending")).toBeTruthy();
    expect(document.querySelector(".security-audit-meter")?.getAttribute("data-level")).toBe("0");
  });

  it("shows staff-cleared public scan summaries as cleared", () => {
    render(
      <DetailSecuritySummary
        auditHref="/suka233/kmind-markdown-to-mindmap/security-audit"
        vtAnalysis={{ status: "suspicious", verdict: "suspicious", checkedAt: 1 }}
        llmAnalysis={{ status: "suspicious", verdict: "suspicious", checkedAt: 1 }}
        suppressScanResults
      />,
    );

    expect(screen.getByText("Cleared")).toBeTruthy();
    expect(screen.queryByText("Warn")).toBeNull();
  });

  it("rolls ClawScan review and warning states into the compact verdict", () => {
    const { rerender } = render(
      <DetailSecuritySummary
        auditHref="/steipete/weather/security-audit"
        vtAnalysis={{ status: "clean", checkedAt: 1 }}
        llmAnalysis={{
          status: "suspicious",
          verdict: "suspicious",
          checkedAt: 1,
          summary: "Review the requested permission boundary.",
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
      />,
    );

    expect(screen.getAllByText("Review").length).toBeGreaterThan(0);

    rerender(
      <DetailSecuritySummary
        auditHref="/steipete/weather/security-audit"
        vtAnalysis={{ status: "clean", checkedAt: 1 }}
        llmAnalysis={{
          status: "suspicious",
          verdict: "suspicious",
          checkedAt: 1,
          summary: "High concern capability mismatch.",
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
      />,
    );

    expect(screen.getAllByText("Warn").length).toBeGreaterThan(0);
    expect(screen.queryByText("Suspicious")).toBeNull();
  });

  it("renders clean scanner outcomes as pass in the user-facing audit UI", () => {
    render(
      <DetailSecuritySummary
        auditHref="/steipete/weather/security-audit"
        vtAnalysis={{ status: "clean", checkedAt: 1 }}
        llmAnalysis={{ status: "clean", summary: "No mismatches found.", checkedAt: 1 }}
      />,
    );

    expect(screen.getByText("Pass")).toBeTruthy();
    expect(screen.queryByText("Benign")).toBeNull();
    expect(document.querySelector(".security-audit-meter")?.getAttribute("data-level")).toBe("4");
  });

  it("renders malicious ClawScan outcomes with the lowest safety meter level", () => {
    render(
      <DetailSecuritySummary
        auditHref="/steipete/weather/security-audit"
        vtAnalysis={{ status: "clean", checkedAt: 1 }}
        llmAnalysis={{
          status: "malicious",
          verdict: "malicious",
          summary: "External transfer.",
          checkedAt: 1,
        }}
      />,
    );

    expect(screen.getByText("Malicious")).toBeTruthy();
    expect(document.querySelector(".security-audit-meter")?.getAttribute("data-level")).toBe("1");
  });

  it("keeps legacy non-engine VirusTotal fields neutral in the aggregate verdict", () => {
    render(
      <DetailSecuritySummary
        auditHref="/tokauthai/skillscan/security-audit"
        vtAnalysis={{
          status: "suspicious",
          source: "legacy-ai",
          scanner: "legacy-ai",
          analysis: "Legacy AI advisory context.",
          checkedAt: 1,
        }}
        llmAnalysis={{ status: "clean", summary: "No ClawScan issues.", checkedAt: 1 }}
      />,
    );

    expect(screen.getByText("Pass")).toBeTruthy();
    expect(screen.queryByText("Advisory")).toBeNull();
    expect(screen.queryByText("Warn")).toBeNull();
  });

  it("renders legacy VirusTotal AI fields without engine stats as neutral", () => {
    render(
      <DetailSecuritySummary
        auditHref="/tokauthai/skillscan/security-audit"
        vtAnalysis={{
          status: "suspicious",
          source: "legacy-ai",
          scanner: "legacy-ai",
          analysis: "Legacy AI advisory context.",
          checkedAt: 1,
        }}
        llmAnalysis={{ status: "clean", checkedAt: 1 }}
      />,
    );

    expect(screen.getByText("Pass")).toBeTruthy();
    expect(screen.queryByText("Warn")).toBeNull();
  });

  it("renders VirusTotal undetected-only fallback as pass", () => {
    render(
      <DetailSecuritySummary
        auditHref="/plugins/@opik/opik-openclaw/security-audit"
        vtAnalysis={{
          status: "clean",
          verdict: "undetected-only-fallback",
          analysis:
            "VirusTotal reported no malicious or suspicious engine hits. ClawHub promoted this source-linked package after clean LLM and clean static scans.",
          source: "engines-undetected-fallback",
          checkedAt: 1,
        }}
        llmAnalysis={{ status: "clean", checkedAt: 1 }}
      />,
    );

    expect(screen.getByText("Pass")).toBeTruthy();
    expect(screen.queryByText("undetected-only-fallback")).toBeNull();
  });

  it("keeps ClawScan clean summaries passing while static findings remain internal", () => {
    render(
      <DetailSecuritySummary
        auditHref="/steipete/weather/security-audit"
        vtAnalysis={{ status: "clean", checkedAt: 1 }}
        llmAnalysis={{ status: "clean", checkedAt: 1 }}
      />,
    );

    expect(screen.getByText("Pass")).toBeTruthy();
    expect(screen.queryByText("Review")).toBeNull();
    expect(screen.queryByText("Warn")).toBeNull();
  });

  it("does not let supporting scanner operational errors drive the compact verdict", () => {
    render(
      <DetailSecuritySummary
        auditHref="/steipete/weather/security-audit"
        vtAnalysis={{ status: "failed", checkedAt: 1 }}
        llmAnalysis={{ status: "clean", summary: "No ClawScan issues.", checkedAt: 1 }}
      />,
    );

    expect(screen.getByText("Pass")).toBeTruthy();
    expect(screen.queryByText("Error")).toBeNull();
    expect(screen.queryByText("Malicious")).toBeNull();
  });
});
