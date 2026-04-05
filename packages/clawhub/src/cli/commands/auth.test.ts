/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createRegistryModuleMocks, makeGlobalOpts } from "../../../test/cliCommandTestKit.js";

const mockReadGlobalConfig = vi.fn(
  async () => null as { registry?: string; token?: string } | null,
);
const mockWriteGlobalConfig = vi.fn(async (_cfg: unknown) => {});
vi.mock("../../config.js", () => ({
  readGlobalConfig: () => mockReadGlobalConfig(),
  writeGlobalConfig: (cfg: unknown) => mockWriteGlobalConfig(cfg),
}));

const registryMocks = createRegistryModuleMocks();
const mockGetRegistry = registryMocks.getRegistry;
vi.mock("../registry.js", () => registryMocks.moduleFactory());

const { cmdLogout } = await import("./auth");

const mockLog = vi.spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  vi.clearAllMocks();
  mockLog.mockClear();
});

describe("cmdLogout", () => {
  it("removes token and logs a clear message", async () => {
    mockReadGlobalConfig.mockResolvedValueOnce({ registry: "https://clawhub.ai", token: "tkn" });

    await cmdLogout(makeGlobalOpts());

    expect(mockWriteGlobalConfig).toHaveBeenCalledWith({
      registry: "https://clawhub.ai",
      token: undefined,
    });
    expect(mockGetRegistry).not.toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith(
      "OK. Logged out locally. Token still valid until revoked (Settings -> API tokens).",
    );
  });

  it("falls back to resolved registry when config has no registry", async () => {
    mockReadGlobalConfig.mockResolvedValueOnce({ token: "tkn" });
    mockGetRegistry.mockResolvedValueOnce("https://registry.example");

    await cmdLogout(makeGlobalOpts());

    expect(mockGetRegistry).toHaveBeenCalled();
    expect(mockWriteGlobalConfig).toHaveBeenCalledWith({
      registry: "https://registry.example",
      token: undefined,
    });
  });
});
