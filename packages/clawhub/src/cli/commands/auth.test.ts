/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHttpModuleMocks,
  createRegistryModuleMocks,
  createUiModuleMocks,
  makeGlobalOpts,
} from "../../../test/cliCommandTestKit.js";

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

const httpMocks = createHttpModuleMocks();
const mockApiRequest = httpMocks.apiRequest;
vi.mock("../../http.js", () => httpMocks.moduleFactory());

const uiMocks = createUiModuleMocks();
const mockFail = uiMocks.fail;
const mockSpinner = uiMocks.spinner;
const mockPromptHidden = vi.fn(async () => "prompted-token");
vi.mock("../ui.js", () => ({
  createSpinner: vi.fn(() => mockSpinner),
  fail: (message: string) => mockFail(message),
  formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  promptHidden: () => mockPromptHidden(),
}));

const mockDiscoverRegistryFromSite = vi.fn(
  async (_site: string) => null as { authBase?: string } | null,
);
vi.mock("../../discovery.js", () => ({
  discoverRegistryFromSite: (site: string) => mockDiscoverRegistryFromSite(site),
}));

const mockRequestDeviceCode = vi.fn(async (_config: unknown) => ({
  device_code: "device_code_123",
  user_code: "ABCD-2345",
  verification_uri: "https://clawhub.ai/cli/device?code=ABCD-2345",
  expires_in: 900,
  interval: 0,
}));
const mockPollForDeviceToken = vi.fn(
  async (_config: unknown, _deviceCode: string, _options: unknown) => ({
    access_token: "device-token",
    token_type: "bearer",
    scope: "read write",
  }),
);
vi.mock("../../deviceAuth.js", () => ({
  requestDeviceCode: (config: unknown) => mockRequestDeviceCode(config),
  pollForDeviceToken: (config: unknown, deviceCode: string, options: unknown) =>
    mockPollForDeviceToken(config, deviceCode, options),
}));

const { cmdLoginFlow, cmdLogout, cmdToken } = await import("./auth");

const mockLog = vi.spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  vi.clearAllMocks();
  mockLog.mockClear();
  mockApiRequest.mockResolvedValue({ user: { handle: "steipete" } });
});

describe("cmdLoginFlow", () => {
  it("stores an explicit token without requesting a device code", async () => {
    mockApiRequest.mockResolvedValueOnce({ user: { handle: "steipete" } });

    await cmdLoginFlow(makeGlobalOpts(), { token: "clh_test_token" }, false);

    expect(mockRequestDeviceCode).not.toHaveBeenCalled();
    expect(mockPollForDeviceToken).not.toHaveBeenCalled();
    expect(mockApiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/whoami",
        token: "clh_test_token",
      }),
      expect.anything(),
    );
    expect(mockWriteGlobalConfig).toHaveBeenCalledWith({
      registry: "https://clawhub.ai",
      token: "clh_test_token",
    });
  });

  it("uses device flow by default and preserves the token label", async () => {
    mockApiRequest.mockResolvedValueOnce({ user: { handle: "steipete" } });

    await cmdLoginFlow(makeGlobalOpts(), { label: "ssh box" }, false);

    expect(mockRequestDeviceCode).toHaveBeenCalledWith({
      apiUrl: "https://clawhub.ai",
      siteUrl: "https://clawhub.ai",
      label: "ssh box",
    });
    expect(mockPollForDeviceToken).toHaveBeenCalledWith(
      { apiUrl: "https://clawhub.ai", siteUrl: "https://clawhub.ai" },
      "device_code_123",
      { interval: 0, expiresIn: 900 },
    );
    expect(mockWriteGlobalConfig).toHaveBeenCalledWith({
      registry: "https://clawhub.ai",
      token: "device-token",
    });
  });

  it("keeps --no-browser on the device flow path", async () => {
    mockApiRequest.mockResolvedValueOnce({ user: { handle: "steipete" } });

    await cmdLoginFlow(makeGlobalOpts(), { browser: false, label: "remote box" }, false);

    expect(mockFail).not.toHaveBeenCalled();
    expect(mockRequestDeviceCode).toHaveBeenCalledWith(
      expect.objectContaining({ label: "remote box" }),
    );
  });
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

describe("cmdToken", () => {
  it("prints the stored token", async () => {
    mockReadGlobalConfig.mockResolvedValueOnce({
      registry: "https://clawhub.ai",
      token: "clh_test",
    });

    await cmdToken();

    expect(mockLog).toHaveBeenCalledWith("clh_test");
  });
});
