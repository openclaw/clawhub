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

const {
  cmdTransferAccept,
  cmdTransferCancel,
  cmdTransferList,
  cmdTransferReject,
  cmdTransferRequest,
} = await import("./transfer");

const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  vi.clearAllMocks();
});

describe("transfer commands", () => {
  it("request requires --yes when input is disabled", async () => {
    await expect(cmdTransferRequest(makeGlobalOpts(), "demo", "@alice", {}, false)).rejects.toThrow(
      /--yes/i,
    );
  });

  it("request calls transfer endpoint", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      ok: true,
      transferId: "skillOwnershipTransfers:1",
      toUserHandle: "alice",
      expiresAt: Date.now() + 10_000,
    });

    await cmdTransferRequest(
      makeGlobalOpts(),
      "Demo",
      "@Alice",
      { yes: true, message: "Please take over" },
      false,
    );

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/demo/transfer",
      }),
      expect.anything(),
    );
    const requestArgs = httpMocks.apiRequest.mock.calls[0]?.[1] as { body?: string };
    expect(requestArgs.body).toContain('"toUserHandle":"alice"');
  });

  it("list calls incoming transfers endpoint", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      transfers: [],
    });
    await cmdTransferList(makeGlobalOpts(), {});
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/transfers/incoming",
      }),
      expect.anything(),
    );
    expect(consoleLog).toHaveBeenCalledWith("No incoming transfers.");
  });

  it("list supports outgoing endpoint", async () => {
    httpMocks.apiRequest.mockResolvedValueOnce({
      transfers: [],
    });
    await cmdTransferList(makeGlobalOpts(), { outgoing: true });
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/transfers/outgoing",
      }),
      expect.anything(),
    );
    expect(consoleLog).toHaveBeenCalledWith("No outgoing transfers.");
  });

  it("accept/reject/cancel call action endpoints", async () => {
    httpMocks.apiRequest.mockResolvedValue({
      ok: true,
      skillSlug: "demo",
    });

    await cmdTransferAccept(makeGlobalOpts(), "demo", { yes: true }, false);
    await cmdTransferReject(makeGlobalOpts(), "demo", { yes: true }, false);
    await cmdTransferCancel(makeGlobalOpts(), "demo", { yes: true }, false);

    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "POST", path: "/api/v1/skills/demo/transfer/accept" }),
      expect.anything(),
    );
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "POST", path: "/api/v1/skills/demo/transfer/reject" }),
      expect.anything(),
    );
    expect(httpMocks.apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "POST", path: "/api/v1/skills/demo/transfer/cancel" }),
      expect.anything(),
    );
  });
});
