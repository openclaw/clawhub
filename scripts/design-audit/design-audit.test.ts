/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { validateSafeChanges } from "./finalize";
import {
  curatedFindings,
  renderAuditMarkdown,
  shouldOpenAuditPullRequest,
  sortAndDedupeFindings,
  summarizeFindings,
  type AuditFinding,
  type AuditReport,
} from "./report";
import { changedLineFindings, parseAddedLines } from "./source-check";

const finding = (severity: AuditFinding["severity"], id = "token/raw-color"): AuditFinding => ({
  id,
  severity,
  kind: "mechanical",
  file: "src/example.css",
  line: 12,
  message: "Example finding.",
  remediation: "Use a semantic token.",
  reference: "openclaw-design-system/references/tokens.md",
});

describe("design audit reporting", () => {
  it("uses the released skill significance threshold", () => {
    expect(shouldOpenAuditPullRequest({ errors: 1, warnings: 0, info: 0 })).toBe(true);
    expect(shouldOpenAuditPullRequest({ errors: 0, warnings: 1, info: 0 })).toBe(true);
    expect(shouldOpenAuditPullRequest({ errors: 0, warnings: 0, info: 5 })).toBe(false);
    expect(shouldOpenAuditPullRequest({ errors: 0, warnings: 0, info: 6 })).toBe(true);
  });

  it("includes every error and at most five non-errors in the concise report", () => {
    const findings = [
      finding("error", "a"),
      finding("error", "b"),
      ...Array.from({ length: 8 }, (_, index) => finding("info", `info-${index}`)),
    ];
    const curated = curatedFindings(findings);
    expect(curated.expanded.filter((item) => item.severity === "error")).toHaveLength(2);
    expect(curated.expanded.filter((item) => item.severity !== "error")).toHaveLength(5);
    expect(curated.omittedNonErrors).toBe(3);
  });

  it("deduplicates and sorts findings by severity", () => {
    const warning = finding("warning", "warning");
    const findings = sortAndDedupeFindings([
      finding("info", "info"),
      warning,
      warning,
      finding("error", "error"),
    ]);
    expect(findings.map((item) => item.severity)).toEqual(["error", "warning", "info"]);
    expect(summarizeFindings(findings)).toEqual({ errors: 1, warnings: 1, info: 1 });
  });

  it("renders immutable audit provenance", () => {
    const report: AuditReport = {
      designSystemVersion: "v0.0.3",
      consumerSha: "consumer",
      auditBaseSha: "base",
      generatedAt: "2026-07-08T00:00:00.000Z",
      summary: { errors: 0, warnings: 0, info: 0 },
      findings: [],
      changedFiles: [],
      validationCommands: ["bun run ci:static"],
      renderedRoutes: ["/"],
      screenshotPaths: ["home.png"],
      validationPassed: true,
    };
    const markdown = renderAuditMarkdown(report);
    expect(markdown).toContain("`v0.0.3`");
    expect(markdown).toContain("`consumer`");
    expect(markdown).toContain("No significant design-system drift was found.");
  });
});

describe("deterministic source checks", () => {
  it("tracks exact added source line numbers", () => {
    const added = parseAddedLines(
      [
        "diff --git a/src/example.css b/src/example.css",
        "--- a/src/example.css",
        "+++ b/src/example.css",
        "@@ -10,0 +11,2 @@",
        "+color: #f5654a;",
        "+background: var(--accent);",
      ].join("\n"),
    );
    expect(added).toEqual([
      { file: "src/example.css", line: 11, text: "color: #f5654a;" },
      { file: "src/example.css", line: 12, text: "background: var(--accent);" },
    ]);
    expect(changedLineFindings(added).map((item) => item.id)).toEqual([
      "token/raw-color",
      "token/legacy-alias",
    ]);
  });
});

describe("safe fix boundary", () => {
  it("allows bounded existing frontend changes", () => {
    expect(() => validateSafeChanges(["src/example.css"], "10\t5\tsrc/example.css")).not.toThrow();
  });

  it("rejects backend, configuration, and broad changes", () => {
    expect(() => validateSafeChanges(["convex/schema.ts"], "1\t0\tconvex/schema.ts")).toThrow(
      "outside existing frontend source",
    );
    expect(() => validateSafeChanges(["src/example.css"], "401\t0\tsrc/example.css")).toThrow(
      "maximum is 400",
    );
  });
});
