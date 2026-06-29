/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { normalizeInspectorReportForPublish } from "./packageInspectorNode";

describe("package inspector publish normalization", () => {
  it("keeps legacy author-facing hard findings without remediation metadata", () => {
    const result = normalizeInspectorReportForPublish({
      status: "fail",
      summary: { breakageCount: 1, warningCount: 1, issueCount: 2 },
      issues: [
        {
          code: "package-entrypoint-missing",
          level: "breakage",
          message: "declared OpenClaw entrypoint does not exist",
        },
        {
          code: "runtime-tool-capture",
          level: "warning",
          message: "runtime tools need capture before contract judgment",
        },
      ],
    });

    expect(result).toMatchObject({
      status: "fail",
      summary: {
        breakageCount: 1,
        warningCount: 0,
        issueCount: 1,
      },
      breakages: [
        {
          code: "package-entrypoint-missing",
          authorRemediation: {
            summary:
              "Publish the entrypoint declared in OpenClaw package metadata or update the metadata to point at an existing file.",
            docsUrl:
              "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#package-entrypoint-missing",
          },
        },
      ],
      warnings: [],
    });
  });

  it("keeps legacy author-facing warnings and drops internal coverage findings", () => {
    const result = normalizeInspectorReportForPublish({
      status: "pass",
      summary: { breakageCount: 0, warningCount: 3, issueCount: 3 },
      warnings: [
        {
          code: "package-plugin-api-compat-missing",
          level: "warning",
          issueClass: "upstream-metadata",
          message: "package.json is missing openclaw.compat.pluginApi",
        },
        {
          code: "runtime-tool-capture",
          level: "warning",
          message: "runtime tools need capture before contract judgment",
        },
        {
          code: "sdk-session-file-helper",
          level: "warning",
          issueClass: "deprecation-warning",
          message: "deprecated session file-path helper is still used",
        },
      ],
    });

    expect(result).toMatchObject({
      status: "pass",
      summary: {
        breakageCount: 0,
        warningCount: 2,
        issueCount: 2,
      },
      warnings: [
        {
          code: "package-plugin-api-compat-missing",
          authorRemediation: {
            summary: "Declare the OpenClaw plugin API range this package supports.",
            docsUrl:
              "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#package-plugin-api-compat-missing",
          },
        },
        {
          code: "sdk-session-file-helper",
          authorRemediation: {
            summary:
              "Replace deprecated session file-path helpers with session entry and transcript identity APIs.",
            docsUrl:
              "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#sdk-session-file-helper",
          },
        },
      ],
    });
  });
});
