/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiV1PackageValidationReportPageSchema } from "../../../clawhub/src/schema/index.js";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../clawhub/test/cliCommandTestKit.js";

const authTokenMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const httpMocks = createHttpModuleMocks();
const uiMocks = createUiModuleMocks();

vi.mock("../../../clawhub/src/cli/authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../../../clawhub/src/cli/registry.js", () => registryMocks.moduleFactory());
vi.mock("../../../clawhub/src/http.js", () => httpMocks.moduleFactory());
vi.mock("../../../clawhub/src/cli/ui.js", () => uiMocks.moduleFactory());

const {
  cmdExportPackageValidationReport,
  cmdHardDeletePackage,
  cmdRepairPackageName,
  cmdRepairPackageRuntimeId,
  cmdTransferPackageOwner,
} = await import("./packages");

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  httpMocks.apiRequest.mockReset();
  vi.useRealTimers();
});

describe("cmdExportPackageValidationReport", () => {
  it("fetches every page and writes one catalog-wide JSON document", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T20:00:00.000Z"));
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const clean = {
      package: { id: "packages:alpha", name: "alpha", displayName: "Alpha" },
      release: { id: "packageReleases:alpha", version: "1.0.0", createdAt: 100 },
      references: { packagePage: "/plugins/alpha", release: "alpha@1.0.0" },
      scan: {
        status: "clean",
        scannedAt: 200,
        target: { channel: "beta", version: "2026.7.30-beta.1" },
        inspectorVersion: "0.5.0",
        skipReason: null,
      },
      findings: [],
    };
    const failing = {
      package: { id: "packages:beta", name: "beta", displayName: "Beta" },
      release: { id: "packageReleases:beta", version: "2.0.0", createdAt: 300 },
      references: { packagePage: "/plugins/beta", release: "beta@2.0.0" },
      scan: {
        status: "error",
        scannedAt: 400,
        target: { channel: "beta", version: "2026.7.30-beta.1" },
        inspectorVersion: "0.5.0",
        skipReason: null,
      },
      findings: [
        {
          severity: "error",
          code: "missing-api",
          message: "Required API is unavailable",
        },
      ],
    };
    httpMocks.apiRequest
      .mockResolvedValueOnce({ items: [clean], nextCursor: "page-2", done: false })
      .mockResolvedValueOnce({ items: [failing], nextCursor: null, done: true });

    const report = await cmdExportPackageValidationReport(makeGlobalOpts(), { json: true });

    expect(authTokenMocks.requireAuthToken).toHaveBeenCalledOnce();
    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(2);
    expect(httpMocks.apiRequest.mock.calls[0]?.[1]).toMatchObject({ method: "GET", token: "tkn" });
    expect(httpMocks.apiRequest.mock.calls[0]?.[1]?.url).toBe(
      "https://clawhub.ai/api/v1/packages/validation-report?limit=100",
    );
    expect(httpMocks.apiRequest.mock.calls[0]?.[2]).toBe(ApiV1PackageValidationReportPageSchema);
    expect(httpMocks.apiRequest.mock.calls[1]?.[1]?.url).toBe(
      "https://clawhub.ai/api/v1/packages/validation-report?limit=100&cursor=page-2",
    );
    expect(report).toEqual({
      schemaVersion: 1,
      generatedAt: "2026-07-30T20:00:00.000Z",
      source: { registry: "https://clawhub.ai", pages: 2 },
      totals: {
        plugins: 2,
        byScanStatus: { notScanned: 0, skipped: 0, clean: 1, warning: 0, error: 1 },
        findings: { total: 1, bySeverity: { info: 0, warning: 0, error: 1 } },
      },
      plugins: [clean, failing],
    });
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toEqual(report);
    expect(stderr).not.toHaveBeenCalled();
  });

  it("returns an explicit all-zero report for an empty catalog", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T20:00:00.000Z"));
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    httpMocks.apiRequest.mockResolvedValueOnce({ items: [], nextCursor: null, done: true });

    const report = await cmdExportPackageValidationReport(makeGlobalOpts(), { json: true });

    expect(report).toEqual({
      schemaVersion: 1,
      generatedAt: "2026-07-30T20:00:00.000Z",
      source: { registry: "https://clawhub.ai", pages: 1 },
      totals: {
        plugins: 0,
        byScanStatus: { notScanned: 0, skipped: 0, clean: 0, warning: 0, error: 0 },
        findings: { total: 0, bySeverity: { info: 0, warning: 0, error: 0 } },
      },
      plugins: [],
    });
    expect(stdout).toHaveBeenCalledTimes(1);
  });

  it("counts explicit missing, skipped, warning, and mixed-severity scan results", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const makePlugin = (
      id: string,
      status: "not-scanned" | "skipped" | "warning",
      findings: Array<{ severity: "info" | "warning" | "error"; code: string; message: string }>,
    ) => ({
      package: { id: `packages:${id}`, name: id, displayName: id },
      release: { id: `packageReleases:${id}`, version: "1.0.0", createdAt: 100 },
      references: { packagePage: `/plugins/${id}`, release: `${id}@1.0.0` },
      scan: {
        status,
        scannedAt: status === "not-scanned" ? null : 200,
        target: status === "not-scanned" ? null : { channel: "beta", version: "beta.1" },
        inspectorVersion: status === "not-scanned" ? null : "0.5.0",
        skipReason: status === "skipped" ? "unchanged" : null,
      },
      findings,
    });
    httpMocks.apiRequest.mockResolvedValueOnce({
      items: [
        makePlugin("missing", "not-scanned", []),
        makePlugin("skipped", "skipped", []),
        makePlugin("warning", "warning", [
          { severity: "info", code: "info", message: "Informational" },
          { severity: "warning", code: "warning", message: "Warning" },
          { severity: "error", code: "error", message: "Error" },
        ]),
      ],
      nextCursor: null,
      done: true,
    });

    const report = await cmdExportPackageValidationReport(makeGlobalOpts(), { json: true });

    expect(report.totals).toEqual({
      plugins: 3,
      byScanStatus: { notScanned: 1, skipped: 1, clean: 0, warning: 1, error: 0 },
      findings: { total: 3, bySeverity: { info: 1, warning: 1, error: 1 } },
    });
  });

  it("does not write stdout when authentication fails", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    authTokenMocks.requireAuthToken.mockRejectedValueOnce(new Error("Authentication required"));

    await expect(
      cmdExportPackageValidationReport(makeGlobalOpts(), { json: true }),
    ).rejects.toThrow("Authentication required");

    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });

  it("fails closed when the API repeats a pagination cursor", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    httpMocks.apiRequest
      .mockResolvedValueOnce({ items: [], nextCursor: "same-page", done: false })
      .mockResolvedValueOnce({ items: [], nextCursor: "same-page", done: false })
      .mockRejectedValueOnce(new Error("unexpected third request"));

    await expect(
      cmdExportPackageValidationReport(makeGlobalOpts(), { json: true }),
    ).rejects.toThrow("Validation report response repeated a pagination cursor");
    expect(httpMocks.apiRequest).toHaveBeenCalledTimes(2);
    expect(stdout).not.toHaveBeenCalled();
  });

  it("fails closed when pages repeat a plugin", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const plugin = {
      package: { id: "packages:alpha", name: "alpha", displayName: "Alpha" },
      release: { id: "packageReleases:alpha", version: "1.0.0", createdAt: 100 },
      references: { packagePage: "/plugins/alpha", release: "alpha@1.0.0" },
      scan: {
        status: "not-scanned",
        scannedAt: null,
        target: null,
        inspectorVersion: null,
        skipReason: null,
      },
      findings: [],
    };
    httpMocks.apiRequest
      .mockResolvedValueOnce({ items: [plugin], nextCursor: "page-2", done: false })
      .mockResolvedValueOnce({ items: [plugin], nextCursor: null, done: true });

    await expect(
      cmdExportPackageValidationReport(makeGlobalOpts(), { json: true }),
    ).rejects.toThrow("Validation report response repeated package packages:alpha");
    expect(stdout).not.toHaveBeenCalled();
  });

  it("fails closed when a truncated page omits its continuation cursor", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    httpMocks.apiRequest.mockResolvedValueOnce({ items: [], nextCursor: null, done: false });

    await expect(
      cmdExportPackageValidationReport(makeGlobalOpts(), { json: true }),
    ).rejects.toThrow("Validation report response omitted its pagination cursor");
    expect(stdout).not.toHaveBeenCalled();
  });
});

describe("cmdHardDeletePackage", () => {
  it("dry-runs an owner-qualified package by default", async () => {
    const confirmationToken =
      "hard-delete-package:@hxy91819/openclaw-tencent-provider:packages:tencent";
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      packageId: "packages:tencent",
      name: "openclaw-tencent-provider",
      ownerHandle: "hxy91819",
      displayName: "Tencent Cloud",
      runtimeId: "tencent",
      dryRun: true,
      deleted: false,
      confirmationToken,
    });

    const result = await cmdHardDeletePackage(
      makeGlobalOpts(),
      "openclaw-tencent-provider",
      {
        owner: "HXY91819",
        reason: "Free the stale package name for Tencent externalization",
        json: true,
      },
      false,
    );

    expect(result).toMatchObject({
      dryRun: true,
      deleted: false,
      ownerHandle: "hxy91819",
      name: "openclaw-tencent-provider",
    });
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/packages/openclaw-tencent-provider/hard-delete",
        token: "tkn",
        body: {
          ownerHandle: "hxy91819",
          reason: "Free the stale package name for Tencent externalization",
          dryRun: true,
        },
      }),
      expect.anything(),
    );
  });

  it("requires owner, reason, and an apply confirmation token", async () => {
    await expect(
      cmdHardDeletePackage(makeGlobalOpts(), "demo", { reason: "Cleanup" }, false),
    ).rejects.toThrow(/--owner required/i);
    await expect(
      cmdHardDeletePackage(makeGlobalOpts(), "demo", { owner: "openclaw" }, false),
    ).rejects.toThrow(/--reason required/i);
    await expect(
      cmdHardDeletePackage(
        makeGlobalOpts(),
        "demo",
        { owner: "openclaw", reason: "Cleanup", apply: true, yes: true },
        false,
      ),
    ).rejects.toThrow(/--confirm required/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("applies with the exact token and disables retries", async () => {
    const confirmationToken =
      "hard-delete-package:@hxy91819/openclaw-tencent-provider:packages:tencent";
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      packageId: "packages:tencent",
      name: "openclaw-tencent-provider",
      ownerHandle: "hxy91819",
      displayName: "Tencent Cloud",
      runtimeId: "tencent",
      dryRun: false,
      deleted: true,
      confirmationToken,
    });
    await cmdHardDeletePackage(
      makeGlobalOpts(),
      "openclaw-tencent-provider",
      {
        owner: "hxy91819",
        reason: "Cleanup",
        apply: true,
        confirm: confirmationToken,
        yes: true,
      },
      false,
    );
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        retryCount: 0,
        body: {
          ownerHandle: "hxy91819",
          reason: "Cleanup",
          dryRun: false,
          confirmationToken,
        },
      }),
      expect.anything(),
    );
  });
});

describe("cmdRepairPackageName", () => {
  it("defaults to a dry run", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      dryRun: true,
      source: { packageId: "packages:source", name: "@openclaw/openviking" },
      target: { packageId: "packages:target", name: "@openviking/openclaw-plugin" },
      retiredName: "@openviking/openclaw-plugin-retired-20260515",
      operations: [],
    });

    await cmdRepairPackageName(makeGlobalOpts(), "@openclaw/openviking", {
      nextName: "@openviking/openclaw-plugin",
      retireTarget: true,
      reason: "Admin repair for openclaw/clawhub#2133",
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/packages/%40openclaw%2Fopenviking/repair-name",
        token: "tkn",
        body: {
          nextName: "@openviking/openclaw-plugin",
          retireTarget: true,
          reason: "Admin repair for openclaw/clawhub#2133",
          dryRun: true,
        },
      }),
      expect.anything(),
    );
  });

  it("passes apply and owner transfer options explicitly", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      dryRun: false,
      source: { packageId: "packages:source", name: "@openviking/openclaw-plugin" },
      target: { packageId: "packages:target", name: "@openviking/openclaw-plugin" },
      retiredName: "@openviking/openclaw-plugin-retired-20260515",
      operations: [],
    });

    await cmdRepairPackageName(makeGlobalOpts(), "@openclaw/openviking", {
      nextName: "@openviking/openclaw-plugin",
      retireTarget: true,
      owner: "openviking",
      reason: "Admin repair for openclaw/clawhub#2133",
      apply: true,
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        body: {
          nextName: "@openviking/openclaw-plugin",
          retireTarget: true,
          owner: "openviking",
          reason: "Admin repair for openclaw/clawhub#2133",
          dryRun: false,
        },
      }),
      expect.anything(),
    );
  });

  it("requires a reason", async () => {
    await expect(
      cmdRepairPackageName(makeGlobalOpts(), "@openclaw/openviking", {
        nextName: "@openviking/openclaw-plugin",
      }),
    ).rejects.toThrow(/--reason required/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });
});

describe("cmdRepairPackageRuntimeId", () => {
  it("defaults to a dry run", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      dryRun: true,
      source: {
        packageId: "packages:stepfun",
        name: "@hengm3467/stepfun-openclaw-plugin",
        runtimeId: "stepfun",
      },
      operations: [
        {
          action: "repair-runtime-id",
          packageId: "packages:stepfun",
          from: "stepfun",
          to: "stepfun-2",
        },
      ],
    });

    await cmdRepairPackageRuntimeId(makeGlobalOpts(), "@hengm3467/stepfun-openclaw-plugin", {
      nextRuntimeId: "stepfun-2",
      reason: "Release official StepFun runtime id claim",
    });

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/packages/%40hengm3467%2Fstepfun-openclaw-plugin/repair-runtime-id",
        token: "tkn",
        body: {
          nextRuntimeId: "stepfun-2",
          reason: "Release official StepFun runtime id claim",
          dryRun: true,
        },
      }),
      expect.anything(),
    );
  });

  it("requires a runtime id and reason", async () => {
    await expect(
      cmdRepairPackageRuntimeId(makeGlobalOpts(), "@hengm3467/stepfun-openclaw-plugin", {
        reason: "Release official StepFun runtime id claim",
      }),
    ).rejects.toThrow(/--next-runtime-id required/i);
    await expect(
      cmdRepairPackageRuntimeId(makeGlobalOpts(), "@hengm3467/stepfun-openclaw-plugin", {
        nextRuntimeId: "stepfun-2",
      }),
    ).rejects.toThrow(/--reason required/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });
});

describe("cmdTransferPackageOwner", () => {
  it("transfers a package owner through the admin-preserving repair endpoint", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      dryRun: false,
      source: { packageId: "packages:opik", name: "@opik/opik-openclaw" },
      target: null,
      retiredName: null,
      operations: [
        {
          action: "transfer-owner",
          packageId: "packages:opik",
          owner: "opik",
        },
      ],
    });

    await cmdTransferPackageOwner(makeGlobalOpts(), "@opik/opik-openclaw", {
      to: "opik",
      reason: "Move legacy personal package into @opik",
      apply: true,
    });

    expect(authTokenMocks.requireAuthToken).toHaveBeenCalled();
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/packages/%40opik%2Fopik-openclaw/repair-name",
        token: "tkn",
        body: {
          nextName: "@opik/opik-openclaw",
          owner: "opik",
          reason: "Move legacy personal package into @opik",
          dryRun: false,
        },
      }),
      expect.anything(),
    );
  });

  it("requires a reason for package transfers", async () => {
    await expect(
      cmdTransferPackageOwner(makeGlobalOpts(), "@opik/opik-openclaw", { to: "opik" }),
    ).rejects.toThrow(/--reason required/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });
});
