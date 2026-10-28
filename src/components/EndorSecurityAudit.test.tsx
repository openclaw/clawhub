import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildSecurityAuditExportEntries } from "../lib/securityAuditExport";
import { SecurityAuditPage } from "./SecurityAuditPage";

const entity = {
  kind: "plugin" as const,
  title: "Slack",
  name: "@openclaw/slack",
  version: "2026.7.1",
  detailPath: "/plugins/@openclaw/slack",
};

describe("stored Endor plugin scan", () => {
  it("shows vulnerability facts and the reported direct dependency, preserving the original export", () => {
    const analysis = {
      status: "completed" as const,
      checkedAt: Date.parse("2026-09-15T00:00:00Z"),
      reachableFunctionCount: 1,
      findings: [
        {
          severity: "critical",
          summary:
            "minimist@1.2.5 has a critical vulnerability identified by GHSA-xvch-5gv4-984h: Prototype Pollution in minimist. A vulnerable function is reachable. This vulnerability was fixed in version 1.2.6.\nminimist@1.2.5 is a direct dependency of endor-control-vulnerable-20261027@0.0.1.",
        },
      ],
    };
    render(
      <SecurityAuditPage
        entity={entity}
        endorAnalysis={analysis}
        llmAnalysis={{ status: "clean", checkedAt: Date.parse("2026-09-14T00:00:00Z") }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Endor dependency reachability" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Prototype Pollution in minimist" })).toBeTruthy();
    expect(screen.getByText("Critical")).toBeTruthy();
    expect(screen.getByText("1.2.6")).toBeTruthy();
    expect(screen.getByText(/^Direct dependency of/).textContent).toBe(
      "Direct dependency of endor-control-vulnerable-20261027@0.0.1",
    );
    for (const link of screen.getAllByRole("link", { name: "GHSA-xvch-5gv4-984h" })) {
      expect(link.getAttribute("href")).toBe("https://github.com/advisories/GHSA-xvch-5gv4-984h");
    }
    const entries = buildSecurityAuditExportEntries({ entity, endorAnalysis: analysis });
    expect(entries.find((entry) => entry.path === "endor.json")?.value).toEqual(analysis);
  });

  it("keeps unstructured reports and transitive relationships without inventing dependency edges", () => {
    const relationship =
      "sharp@0.33.5 is a transitive dependency of @openclaw/memory-lancedb@2026.9.9 via external direct dependency @lancedb/lancedb@0.39.0. sharp@0.33.5 is a transitive dependency of @lancedb/lancedb@0.39.0.";
    render(
      <SecurityAuditPage
        entity={entity}
        endorAnalysis={{
          status: "completed",
          checkedAt: 1,
          reachableFunctionCount: 2,
          findings: [
            {
              severity: "critical",
              summary: "CVE-2021-44906: Prototype Pollution in minimist.",
            },
            {
              severity: "high",
              summary: `sharp@0.33.5 has a high severity vulnerability identified by GHSA-rgj7-g3m4-5g8c: sharp: Vulnerabilities in libheif. A vulnerable function is reachable. This vulnerability was fixed in version 0.35.4.\n${relationship}`,
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "CVE-2021-44906" }).getAttribute("href")).toBe(
      "https://nvd.nist.gov/vuln/detail/CVE-2021-44906",
    );
    expect(screen.getByRole("link", { name: "CVE-2021-44906" }).closest("p")?.textContent).toBe(
      "CVE-2021-44906: Prototype Pollution in minimist.",
    );
    expect(screen.getByText(relationship)).toBeTruthy();
    expect(screen.queryByText(/Direct dependency of/)).toBeNull();
  });

  it("shows an Endor failure and exports it without changing the primary verdict", () => {
    const analysis = {
      status: "failed" as const,
      checkedAt: 1,
      reason: "Run a rescan to try again.",
    };
    render(
      <SecurityAuditPage
        entity={entity}
        endorAnalysis={analysis}
        llmAnalysis={{ status: "malicious", verdict: "malicious", checkedAt: 1 }}
      />,
    );
    expect(screen.getByText("Scan failed: Run a rescan to try again.")).toBeTruthy();
    expect(screen.queryByText("No reachable vulnerabilities reported")).toBeNull();
    expect(screen.getAllByText("Malicious").length).toBeGreaterThan(0);
    const entries = buildSecurityAuditExportEntries({ entity, endorAnalysis: analysis });
    expect(entries.find((entry) => entry.path === "endor.json")?.value).toEqual(analysis);
  });
});
