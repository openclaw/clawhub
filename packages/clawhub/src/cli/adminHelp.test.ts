/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";

const mockReadGlobalConfig = vi.fn(
  async () => null as { registry?: string; token?: string } | null,
);
vi.mock("../config.js", () => ({
  readGlobalConfig: () => mockReadGlobalConfig(),
}));

const mockApiRequest = vi.fn();
vi.mock("../http.js", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const { isHelpRequest, shouldShowAdminCommandsInHelp } = await import("./adminHelp");

afterEach(() => {
  vi.clearAllMocks();
});

describe("admin help gating", () => {
  it("treats root help-like invocations as help requests", () => {
    expect(isHelpRequest(["node", "clawhub", "--help"])).toBe(true);
    expect(isHelpRequest(["node", "clawhub", "help"])).toBe(true);
    expect(isHelpRequest(["node", "clawhub"])).toBe(true);
    expect(isHelpRequest(["node", "clawhub", "search", "weather"])).toBe(false);
  });

  it("does not hide commands for normal command execution", async () => {
    await expect(
      shouldShowAdminCommandsInHelp({
        argv: ["node", "clawhub", "ban-user", "demo"],
      }),
    ).resolves.toBe(true);
    expect(mockReadGlobalConfig).not.toHaveBeenCalled();
  });

  it("hides admin commands from help when logged out", async () => {
    mockReadGlobalConfig.mockResolvedValueOnce(null);

    await expect(
      shouldShowAdminCommandsInHelp({
        argv: ["node", "clawhub", "--help"],
      }),
    ).resolves.toBe(false);
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("shows admin commands in help for stored admin tokens", async () => {
    mockReadGlobalConfig.mockResolvedValueOnce({
      registry: "https://registry.example",
      token: "clh_admin",
    });
    mockApiRequest.mockResolvedValueOnce({
      user: { handle: "p", role: "admin" },
    });

    await expect(
      shouldShowAdminCommandsInHelp({
        argv: ["node", "clawhub", "--help"],
      }),
    ).resolves.toBe(true);
    expect(mockApiRequest).toHaveBeenCalledWith(
      "https://registry.example",
      expect.objectContaining({ path: "/api/v1/whoami", token: "clh_admin" }),
      expect.anything(),
    );
  });

  it("hides admin commands in help for non-admin tokens", async () => {
    mockReadGlobalConfig.mockResolvedValueOnce({
      registry: "https://registry.example",
      token: "clh_user",
    });
    mockApiRequest.mockResolvedValueOnce({
      user: { handle: "p", role: "moderator" },
    });

    await expect(
      shouldShowAdminCommandsInHelp({
        argv: ["node", "clawhub", "--help"],
      }),
    ).resolves.toBe(false);
  });
});
