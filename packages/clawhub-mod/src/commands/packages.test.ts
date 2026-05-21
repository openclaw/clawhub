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

const { cmdRepairPackageName } = await import("./packages");

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
