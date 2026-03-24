/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlobalOpts } from "../types";

vi.mock("../authToken.js", () => ({
  requireAuthToken: vi.fn(async () => "tkn"),
}));

vi.mock("../registry.js", () => ({
  getRegistry: vi.fn(async () => "https://clawhub.ai"),
}));

const mockApiRequest = vi.fn();
vi.mock("../../http.js", () => ({
  apiRequest: (registry: unknown, args: unknown, schema?: unknown) =>
    mockApiRequest(registry, args, schema),
}));

vi.mock("../ui.js", () => ({
  createSpinner: vi.fn(() => ({ succeed: vi.fn(), fail: vi.fn(), stop: vi.fn() })),
  fail: (message: string) => {
    throw new Error(message);
  },
  formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  isInteractive: () => false,
  promptConfirm: vi.fn(async () => true),
}));

const {
  cmdTransferAccept,
  cmdTransferCancel,
  cmdTransferList,
  cmdTransferReject,
  cmdTransferRequest,
} = await import("./transfer");

function makeOpts(): GlobalOpts {
  return {
    workdir: "/work",
    dir: "/work/skills",
    site: "https://clawhub.ai",
    registry: "https://clawhub.ai",
    registrySource: "default",
  };
}

const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  vi.clearAllMocks();
});

describe("transfer commands", () => {
  it("request requires --yes when input is disabled", async () => {
    await expect(cmdTransferRequest(makeOpts(), "demo", "@alice", {}, false)).rejects.toThrow(
      /--yes/i,
    );
  });

  it("request calls transfer endpoint", async () => {
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      transferId: "skillOwnershipTransfers:1",
      toUserHandle: "alice",
      expiresAt: Date.now() + 10_000,
    });

    await cmdTransferRequest(
      makeOpts(),
      "Demo",
      "@Alice",
      { yes: true, message: "Please take over" },
      false,
    );

    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: "POST",
        path: "/api/v1/skills/demo/transfer",
      }),
      expect.anything(),
    );
    const requestArgs = mockApiRequest.mock.calls[0]?.[1] as { body?: string };
    expect(requestArgs.body).toContain('"toUserHandle":"alice"');
  });

  it("list calls incoming transfers endpoint", async () => {
    mockApiRequest.mockResolvedValueOnce({
      transfers: [],
    });
    await cmdTransferList(makeOpts(), {});
    expect(mockApiRequest).toHaveBeenCalledWith(
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
    mockApiRequest.mockResolvedValueOnce({
      transfers: [],
    });
    await cmdTransferList(makeOpts(), { outgoing: true });
    expect(mockApiRequest).toHaveBeenCalledWith(
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
    mockApiRequest.mockResolvedValue({
      ok: true,
      skillSlug: "demo",
    });

    await cmdTransferAccept(makeOpts(), "demo", { yes: true }, false);
    await cmdTransferReject(makeOpts(), "demo", { yes: true }, false);
    await cmdTransferCancel(makeOpts(), "demo", { yes: true }, false);

    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "POST", path: "/api/v1/skills/demo/transfer/accept" }),
      expect.anything(),
    );
    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "POST", path: "/api/v1/skills/demo/transfer/reject" }),
      expect.anything(),
    );
    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "POST", path: "/api/v1/skills/demo/transfer/cancel" }),
      expect.anything(),
    );
  });
});
