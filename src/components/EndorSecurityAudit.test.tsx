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
  it("shows the stored reachable finding and includes it in the audit export", () => {
    const analysis = {
      status: "completed" as const,
      checkedAt: Date.parse("2026-09-15T00:00:00Z"),
      reachableFunctionCount: 1,
      findings: [{ severity: "high", summary: "Axios uploads bypass maxBodyLength." }],
    };
    render(
      <SecurityAuditPage
        entity={entity}
        endorAnalysis={analysis}
        llmAnalysis={{ status: "clean", checkedAt: Date.parse("2026-09-14T00:00:00Z") }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Endor dependency reachability" })).toBeTruthy();
    expect(screen.getByText("Axios uploads bypass maxBodyLength.", { exact: false })).toBeTruthy();
    expect(screen.getByText("high")).toBeTruthy();
    const entries = buildSecurityAuditExportEntries({ entity, endorAnalysis: analysis });
    expect(entries.find((entry) => entry.path === "endor.json")?.value).toEqual(analysis);
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
    expect(screen.queryByText(/Endor found no vulnerabilities/)).toBeNull();
    expect(screen.getAllByText("Malicious").length).toBeGreaterThan(0);
    const entries = buildSecurityAuditExportEntries({ entity, endorAnalysis: analysis });
    expect(entries.find((entry) => entry.path === "endor.json")?.value).toEqual(analysis);
  });
});
