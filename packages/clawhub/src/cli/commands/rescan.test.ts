/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthTokenModuleMocks,
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../test/cliCommandTestKit.js";

const authTokenMocks = createAuthTokenModuleMocks();
const registryMocks = createRegistryModuleMocks();
const httpMocks = createHttpModuleMocks();
const uiMocks = createUiModuleMocks();

vi.mock("../authToken.js", () => authTokenMocks.moduleFactory());
vi.mock("../registry.js", () => registryMocks.moduleFactory());
vi.mock("../../http.js", () => httpMocks.moduleFactory());
vi.mock("../ui.js", () => uiMocks.moduleFactory());

const { cmdRescanPackage, cmdRescanSkill } = await import("./rescan");

const mockLog = vi.spyOn(console, "log").mockImplementation(() => {});

const response = {
  ok: true,
  targetKind: "skill",
  name: "demo",
  version: "1.2.3",
  status: "in_progress",
  remainingRequests: 2,
  maxRequests: 3,
  pendingRequestId: "rescanRequests:1",
};

afterEach(() => {
  vi.clearAllMocks();
  mockLog.mockClear();
});

describe("rescan commands", () => {
  it("requires --yes when input is disabled", async () => {
    await expect(cmdRescanSkill(makeGlobalOpts(), "demo", {}, false)).rejects.toThrow(/--yes/i);
    await expect(cmdRescanPackage(makeGlobalOpts(), "demo", {}, false)).rejects.toThrow(/--yes/i);
    expect(httpMocks.apiRequest).not.toHaveBeenCalled();
  });

  it("posts skill rescans to the skill rescan endpoint", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce(response);

    await cmdRescanSkill(makeGlobalOpts(), "Demo", { yes: true }, false);

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "POST", path: "/api/v1/skills/demo/rescan" }),
      expect.anything(),
    );
    expect(uiMocks.spinner.succeed).toHaveBeenCalledWith(
      "OK. Requested skill rescan for demo@1.2.3 (2/3 remaining)",
    );
  });

  it("posts package rescans to the package rescan endpoint", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ...response,
      targetKind: "package",
      name: "@scope/demo",
    });

    await cmdRescanPackage(makeGlobalOpts(), "@scope/demo", { yes: true }, false);

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/packages/%40scope%2Fdemo/rescan",
      }),
      expect.anything(),
    );
  });

  it("prints JSON output", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce(response);

    await cmdRescanSkill(makeGlobalOpts(), "demo", { yes: true, json: true }, false);

    expect(uiMocks.spinner.stop).toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(response, null, 2));
  });
});
