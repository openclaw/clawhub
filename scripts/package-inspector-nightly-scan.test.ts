/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { normalizeFindings } from "./package-inspector-nightly-scan";

describe("package-inspector-nightly-scan", () => {
  it("preserves author remediation when normalizing inspector issues for upload", () => {
    const findings = normalizeFindings({
      issues: [
        {
          code: "sdk-load-session-store",
          level: "warning",
          severity: "P2",
          issueClass: "deprecated-api",
          message: "loadSessionStore reads the whole session store.",
          authorRemediation: {
            summary: "Replace loadSessionStore with targeted session table APIs.",
            docsUrl: "https://clawhub.ai/docs/plugin-validation-fixes#sdk-load-session-store",
          },
        },
      ],
    });

    expect(findings).toEqual([
      expect.objectContaining({
        code: "sdk-load-session-store",
        authorRemediation: {
          summary: "Replace loadSessionStore with targeted session table APIs.",
          docsUrl: "https://clawhub.ai/docs/plugin-validation-fixes#sdk-load-session-store",
        },
      }),
    ]);
  });

  it("omits malformed remediation and non-author-facing inspector gaps", () => {
    const findings = normalizeFindings({
      issues: [
        {
          code: "sdk-session-store-write",
          message: "writeSessionStore writes the whole session store.",
          authorRemediation: {
            summary: "  ",
            docsUrl: "https://clawhub.ai/docs/plugin-validation-fixes#sdk-session-store-write",
          },
        },
        {
          code: "internal-inspector-gap",
          issueClass: "inspector-gap",
          message: "The inspector needs a follow-up rule.",
          authorRemediation: {
            summary: "This should not be shown to plugin authors.",
          },
        },
      ],
    });

    expect(findings).toEqual([
      expect.objectContaining({
        code: "sdk-session-store-write",
        authorRemediation: undefined,
      }),
    ]);
  });
});
