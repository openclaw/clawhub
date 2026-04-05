import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SecurityScanResults } from "./SkillSecurityScanResults";

describe("SecurityScanResults static guidance", () => {
  it("renders capability-only states without scanner verdicts", () => {
    render(<SecurityScanResults capabilityTags={["posts-externally", "requires-oauth-token"]} />);

    expect(screen.getByText("Capability signals")).toBeTruthy();
    expect(screen.getByText("Posts externally")).toBeTruthy();
    expect(screen.getByText("Requires OAuth token")).toBeTruthy();
  });

  it("renders capability labels separately from scan verdicts", () => {
    render(
      <SecurityScanResults
        capabilityTags={["crypto", "requires-wallet", "can-make-purchases"]}
        llmAnalysis={{ status: "clean", checkedAt: Date.now() }}
      />,
    );

    expect(screen.getByText("Capability signals")).toBeTruthy();
    expect(screen.getByText("Crypto")).toBeTruthy();
    expect(screen.getByText("Requires wallet")).toBeTruthy();
    expect(screen.getByText("Can make purchases")).toBeTruthy();
  });

  it("shows external-clearance guidance only for allowlisted static findings", () => {
    render(
      <SecurityScanResults
        vtAnalysis={{ status: "clean", checkedAt: Date.now() }}
        llmAnalysis={{ status: "clean", checkedAt: Date.now() }}
        staticFindings={[
          {
            code: "suspicious.env_credential_access",
            severity: "critical",
            file: "index.ts",
            line: 1,
            message: "Environment variable access combined with network send.",
            evidence: "process.env.API_KEY",
          },
        ]}
      />,
    );

    expect(screen.getByText("Confirmed safe by external scanners")).toBeTruthy();
  });

  it("keeps warning guidance for mixed static findings even when scanners are clean", () => {
    render(
      <SecurityScanResults
        vtAnalysis={{ status: "clean", checkedAt: Date.now() }}
        llmAnalysis={{ status: "clean", checkedAt: Date.now() }}
        staticFindings={[
          {
            code: "suspicious.env_credential_access",
            severity: "critical",
            file: "index.ts",
            line: 1,
            message: "Environment variable access combined with network send.",
            evidence: "process.env.API_KEY",
          },
          {
            code: "suspicious.potential_exfiltration",
            severity: "warn",
            file: "index.ts",
            line: 2,
            message: "File read combined with network send (possible exfiltration).",
            evidence: "readFileSync(secretPath)",
          },
        ]}
      />,
    );

    expect(screen.getByText("Patterns worth reviewing")).toBeTruthy();
    expect(screen.queryByText("Confirmed safe by external scanners")).toBeNull();
  });
});
