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
      findings: [
        { severity: "FINDING_LEVEL_HIGH", summary: "Axios uploads bypass maxBodyLength." },
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
    expect(screen.getByText("Axios uploads bypass maxBodyLength.", { exact: false })).toBeTruthy();
    expect(screen.getByText("high")).toBeTruthy();
    expect(screen.getByText("Sep 15, 2026 · 12:00 AM UTC")).toBeTruthy();
    const entries = buildSecurityAuditExportEntries({ entity, endorAnalysis: analysis });
    expect(entries.find((entry) => entry.path === "endor.json")?.value).toEqual(analysis);
  });

  it("keeps unsupported analysis distinct from a completed scan with zero findings", () => {
    const view = render(
      <SecurityAuditPage
        entity={entity}
        endorAnalysis={{ status: "skipped", checkedAt: 1, reason: "No package.json" }}
      />,
    );
    expect(screen.getByText("Not analyzed: No package.json")).toBeTruthy();
    expect(screen.queryByText(/Endor found no vulnerabilities/)).toBeNull();
    view.rerender(
      <SecurityAuditPage
        entity={entity}
        endorAnalysis={{
          status: "completed",
          checkedAt: 2,
          reachableFunctionCount: 0,
          findings: [],
        }}
      />,
    );
    expect(
      screen.getByText("Endor found no vulnerabilities marked as reachable functions."),
    ).toBeTruthy();
  });
});
