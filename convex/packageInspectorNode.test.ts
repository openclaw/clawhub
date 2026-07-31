/* @vitest-environment node */

import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPublishInspectorRunCheckOptions,
  createPackageInspectorWorkspace,
  normalizeInspectorReportForPublish,
  preparePublishInspectorOpenClawTarget,
} from "./packageInspectorNode";

const originalPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
});

describe("package inspector publish normalization", () => {
  it("falls back to /tmp when the configured temp directory is unavailable", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const attemptedPrefixes: string[] = [];
    const createTempDir = async (prefix: string) => {
      attemptedPrefixes.push(prefix);
      if (attemptedPrefixes.length === 1) {
        throw Object.assign(new Error("configured temp directory is unavailable"), {
          code: "ENOENT",
        });
      }
      return `${prefix}workspace`;
    };

    await expect(
      createPackageInspectorWorkspace("/home/sbx_user1051", createTempDir),
    ).resolves.toBe(path.join("/tmp", "clawhub-plugin-inspector-workspace"));
    expect(attemptedPrefixes).toEqual([
      path.join("/home/sbx_user1051", "clawhub-plugin-inspector-"),
      path.join("/tmp", "clawhub-plugin-inspector-"),
    ]);
  });

  it("does not use the POSIX fallback on Windows", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const error = Object.assign(new Error("configured temp directory is unavailable"), {
      code: "ENOENT",
    });
    const createTempDir = async () => {
      throw error;
    };

    await expect(createPackageInspectorWorkspace("C:\\Temp", createTempDir)).rejects.toBe(error);
  });

  it("does not hide unrelated workspace creation errors", async () => {
    const error = Object.assign(new Error("temporary storage failed"), { code: "EIO" });
    const createTempDir = async () => {
      throw error;
    };

    await expect(createPackageInspectorWorkspace("/home/sbx_user1051", createTempDir)).rejects.toBe(
      error,
    );
  });

  it("prepares latest stable OpenClaw with a cache outside the inspected package", async () => {
    const resolvedTarget = { version: "2026.7.0" };
    const preparedTarget = { status: "ok", version: "2026.7.0" };
    const resolveVersion = vi.fn(async () => resolvedTarget);
    const prepare = vi.fn(async () => preparedTarget);

    await expect(
      preparePublishInspectorOpenClawTarget("/tmp/plugin", { resolveVersion, prepare }),
    ).resolves.toBe(preparedTarget);
    expect(resolveVersion).toHaveBeenCalledWith("latest");
    expect(prepare).toHaveBeenCalledWith(resolvedTarget, {
      cacheDir: path.join("/tmp/plugin", ".plugin-inspector-cache"),
    });
    expect(path.join("/tmp/plugin", ".plugin-inspector-cache")).not.toContain(
      path.join("/tmp/plugin", "package") + path.sep,
    );
  });

  it("uses the prepared OpenClaw target for publish-time inspection", () => {
    const targetOpenClaw = { status: "ok", version: "2026.7.0" };
    expect(
      buildPublishInspectorRunCheckOptions(
        "/tmp/plugin",
        "2026-07-30T00:00:00.000Z",
        targetOpenClaw,
      ),
    ).toEqual(
      expect.objectContaining({
        pluginRoot: "/tmp/plugin",
        openclawPath: false,
        targetOpenClaw,
        authorFacing: true,
      }),
    );
  });

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

  it("keeps missing-API findings with generic remediation and no docs URL", () => {
    const result = normalizeInspectorReportForPublish({
      status: "fail",
      summary: { breakageCount: 1, warningCount: 0, issueCount: 1 },
      issues: [
        {
          code: "missing-openclaw-api",
          level: "breakage",
          issueClass: "compatibility-error",
          message: "registerMemoryRuntime is unavailable in the selected OpenClaw target",
          authorRemediation: {
            summary: "Replace this call with an API available in the selected OpenClaw version.",
          },
        },
      ],
    });

    expect(result.breakages).toEqual([
      expect.objectContaining({
        code: "missing-openclaw-api",
        authorRemediation: {
          summary: "Replace this call with an API available in the selected OpenClaw version.",
          docsUrl: undefined,
        },
      }),
    ]);
  });

  it("keeps static and compatibility findings with the exact resolved target", () => {
    const result = normalizeInspectorReportForPublish({
      status: "fail",
      targetOpenClaw: {
        requested: "beta",
        version: "2026.8.0-beta.4",
      },
      issues: [
        {
          code: "package-entrypoint-missing",
          level: "breakage",
          issueClass: "package-integrity",
          message: "declared OpenClaw entrypoint does not exist",
        },
        {
          code: "missing-openclaw-api",
          level: "breakage",
          issueClass: "compatibility-error",
          message: "registerMemoryRuntime is unavailable in the selected OpenClaw target",
          authorRemediation: {
            summary: "Replace this call with an API available in the selected OpenClaw version.",
          },
        },
      ],
    });

    expect(result.metadata.targetOpenClawVersion).toBe("2026.8.0-beta.4");
    expect(result.breakages.map((finding) => finding.code)).toEqual([
      "package-entrypoint-missing",
      "missing-openclaw-api",
    ]);
  });

  it("keeps out-of-range compatibility information non-blocking", () => {
    const result = normalizeInspectorReportForPublish({
      status: "pass",
      targetOpenClaw: { version: "2026.7.2-beta.4" },
      issues: [
        {
          code: "unknown-registration-name",
          level: "suggestion",
          severity: "P2",
          issueClass: "compatibility-information",
          message:
            "plugin calls registrars missing from target OpenClaw outside its declared range",
          authorRemediation: {
            summary: "Widen the declared range only after updating these registrations.",
          },
        },
      ],
    });

    expect(result).toMatchObject({
      status: "pass",
      summary: { breakageCount: 0, warningCount: 1 },
      breakages: [],
      warnings: [
        {
          code: "unknown-registration-name",
          level: "suggestion",
          issueClass: "compatibility-information",
        },
      ],
    });
  });
});
