/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
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

const { cmdRepairPackageName, cmdRepairPackageRuntimeId, cmdTransferPackageOwner } =
  await import("./packages");

afterEach(() => {
  vi.clearAllMocks();
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
