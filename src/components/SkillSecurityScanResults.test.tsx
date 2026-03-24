import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SecurityScanResults } from "./SkillSecurityScanResults";

describe("SecurityScanResults static guidance", () => {
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
