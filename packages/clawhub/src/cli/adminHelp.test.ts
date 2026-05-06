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

const {
  commandOptionsForAudience,
  createCommandPathRegistry,
  isHelpRequest,
  resolveHelpRole,
  shouldShowAdminCommandsInHelp,
  shouldShowAudienceInHelp,
} = await import("./adminHelp");

afterEach(() => {
  vi.clearAllMocks();
});

function createTestCommandPaths() {
  const paths = createCommandPathRegistry();
  for (const path of [
    ["search"],
    ["ban-user"],
    ["package", "trusted-publisher", "get"],
    ["package", "trusted-publisher", "set"],
  ]) {
    paths.add(path);
  }
  return paths;
}

describe("admin help gating", () => {
  it("treats root help-like invocations as help requests", () => {
    const paths = createTestCommandPaths();

    expect(isHelpRequest(["node", "clawhub", "--help"], paths)).toBe(true);
    expect(isHelpRequest(["node", "clawhub", "help"], paths)).toBe(true);
    expect(isHelpRequest(["node", "clawhub"], paths)).toBe(true);
    expect(isHelpRequest(["node", "clawhub", "package"], paths)).toBe(true);
    expect(isHelpRequest(["node", "clawhub", "package", "trusted-publisher"], paths)).toBe(true);
    expect(isHelpRequest(["node", "clawhub", "search", "weather"], paths)).toBe(false);
    expect(
      isHelpRequest(["node", "clawhub", "--registry", "https://r.example", "search", "x"], paths),
    ).toBe(false);
    expect(
      isHelpRequest(
        [
          "node",
          "clawhub",
          "--registry=https://r.example",
          "--workdir",
          "/tmp/demo",
          "package",
          "trusted-publisher",
          "set",
          "demo",
          "--repository",
          "openclaw/demo",
        ],
        paths,
      ),
    ).toBe(false);
  });

  it("treats unknown commands as help requests so error help stays filtered", () => {
    const paths = createTestCommandPaths();

    expect(isHelpRequest(["node", "clawhub", "upgrade"], paths)).toBe(true);
    expect(isHelpRequest(["node", "clawhub", "package", "bogus"], paths)).toBe(true);
    expect(isHelpRequest(["node", "clawhub", "package", "trusted-publisher", "bogus"], paths)).toBe(
      true,
    );
    expect(isHelpRequest(["node", "clawhub", "package", "trusted-publisher", "get"], paths)).toBe(
      false,
    );
  });

  it("does not hide commands for normal command execution", async () => {
    await expect(
      shouldShowAdminCommandsInHelp({
        argv: ["node", "clawhub", "ban-user", "demo"],
        commandPaths: createTestCommandPaths(),
      }),
    ).resolves.toBe(true);
    expect(mockReadGlobalConfig).not.toHaveBeenCalled();
  });

  it("resolves no help role when logged out", async () => {
    mockReadGlobalConfig.mockResolvedValueOnce(null);

    await expect(
      resolveHelpRole({
        argv: ["node", "clawhub", "--help"],
      }),
    ).resolves.toBeNull();
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("resolves admin help role for stored admin tokens", async () => {
    mockReadGlobalConfig.mockResolvedValueOnce({
      registry: "https://registry.example",
      token: "clh_admin",
    });
    mockApiRequest.mockResolvedValueOnce({
      user: { handle: "p", role: "admin" },
    });

    await expect(
      resolveHelpRole({
        argv: ["node", "clawhub", "--help"],
      }),
    ).resolves.toBe("admin");
    expect(mockApiRequest).toHaveBeenCalledWith(
      "https://registry.example",
      expect.objectContaining({ path: "/api/v1/whoami", token: "clh_admin" }),
      expect.anything(),
    );
  });

  it("resolves moderator help role for stored moderator tokens", async () => {
    mockReadGlobalConfig.mockResolvedValueOnce({
      registry: "https://registry.example",
      token: "clh_moderator",
    });
    mockApiRequest.mockResolvedValueOnce({
      user: { handle: "p", role: "moderator" },
    });

    await expect(
      resolveHelpRole({
        argv: ["node", "clawhub", "--help"],
      }),
    ).resolves.toBe("moderator");
  });

  it("keeps the legacy admin-only helper behavior", async () => {
    mockReadGlobalConfig.mockResolvedValueOnce({
      registry: "https://registry.example",
      token: "clh_moderator",
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

  it("maps command audiences to platform roles", () => {
    expect(shouldShowAudienceInHelp("public", null)).toBe(true);
    expect(shouldShowAudienceInHelp("authenticated", null)).toBe(true);
    expect(shouldShowAudienceInHelp("owner", null)).toBe(true);

    expect(shouldShowAudienceInHelp("moderator", null)).toBe(false);
    expect(shouldShowAudienceInHelp("moderator", "user")).toBe(false);
    expect(shouldShowAudienceInHelp("moderator", "moderator")).toBe(true);
    expect(shouldShowAudienceInHelp("moderator", "admin")).toBe(true);

    expect(shouldShowAudienceInHelp("admin", "moderator")).toBe(false);
    expect(shouldShowAudienceInHelp("admin", "admin")).toBe(true);
  });

  it("returns Commander hidden options for hidden audiences", () => {
    expect(commandOptionsForAudience("moderator", "user")).toEqual({ hidden: true });
    expect(commandOptionsForAudience("moderator", "moderator")).toBeUndefined();
    expect(commandOptionsForAudience("admin", "moderator")).toEqual({ hidden: true });
    expect(commandOptionsForAudience("admin", "admin")).toBeUndefined();
  });
});
