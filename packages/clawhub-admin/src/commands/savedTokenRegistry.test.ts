/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import { createHttpModuleMocks, makeGlobalOpts } from "../../../clawhub/test/cliCommandTestKit.js";

// The saved-token helper and the registry resolver run unmocked here, so these
// tests follow the token from the config file to the request.
type SavedConfig = { registry?: string; token?: string };
let savedConfig: SavedConfig | null = null;
const writeGlobalConfig = vi.fn(async (config: SavedConfig) => {
  savedConfig = config;
});
vi.mock("../../../clawhub/src/config.js", () => ({
  readGlobalConfig: async () => savedConfig,
  writeGlobalConfig: (config: SavedConfig) => writeGlobalConfig(config),
}));

const discoverRegistryFromSite = vi.fn(
  async (_site: string) => null as { apiBase?: string } | null,
);
vi.mock("../../../clawhub/src/discovery.js", () => ({
  discoverRegistryFromSite: (site: string) => discoverRegistryFromSite(site),
}));

const http = createHttpModuleMocks();
vi.mock("../../../clawhub/src/http.js", () => http.moduleFactory());

vi.mock("../../../clawhub/src/cli/ui.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../clawhub/src/cli/ui.js")>()),
  fail: (message: string) => {
    throw new Error(message);
  },
}));

const { cmdDownloads } = await import("./downloads");
const { cmdSetPackageFeatured } = await import("./featured");
const { cmdGetManagedMcp } = await import("./managedMcp");
const { cmdListPromotions } = await import("./promotions");

const adminCommands: Array<[string, (opts: GlobalOpts) => Promise<unknown>]> = [
  ["downloads", (opts) => cmdDownloads(opts, { json: true })],
  ["plugins feature", (opts) => cmdSetPackageFeatured(opts, "demo-plugin", true, { json: true })],
  ["managed-mcp get", (opts) => cmdGetManagedMcp(opts, "demo")],
  ["promotions list --all", (opts) => cmdListPromotions(opts, { all: true, json: true })],
];

async function runAndCaptureError(run: () => Promise<unknown>) {
  return await run().then(
    () => null,
    (error: unknown) => error,
  );
}

function sentTokens() {
  return http.apiRequest.mock.calls.map(([, args]) => (args as { token?: string }).token);
}

beforeEach(() => {
  savedConfig = { registry: "https://clawhub.ai", token: "saved" };
  http.apiRequest.mockResolvedValue({ promotions: [], nextCursor: null });
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  discoverRegistryFromSite.mockResolvedValue(null);
});

describe("admin commands keep the saved token on its registry origin", () => {
  it.each(adminCommands)(
    "%s does not send the saved token to an explicit registry on another origin",
    async (_name, run) => {
      const opts: GlobalOpts = {
        ...makeGlobalOpts(),
        registry: "http://127.0.0.1:3211",
        registrySource: "cli",
      };

      const error = await runAndCaptureError(() => run(opts));

      expect(http.apiRequest).not.toHaveBeenCalled();
      expect(String(error)).toContain("Not logged in to this registry. Run: clawhub login");
    },
  );

  it.each(adminCommands)(
    "%s does not send the saved token to a discovered registry on another origin",
    async (_name, run) => {
      discoverRegistryFromSite.mockResolvedValue({ apiBase: "https://other.example" });
      const opts: GlobalOpts = { ...makeGlobalOpts(), site: "https://other.example" };

      const error = await runAndCaptureError(() => run(opts));

      expect(http.apiRequest).not.toHaveBeenCalled();
      expect(String(error)).toContain("Not logged in to this registry. Run: clawhub login");
      // Discovery of another origin leaves the saved login in place.
      expect(writeGlobalConfig).not.toHaveBeenCalled();
      expect(savedConfig).toEqual({ registry: "https://clawhub.ai", token: "saved" });
    },
  );

  it.each(adminCommands)(
    "%s sends the saved token to its own registry origin",
    async (_name, run) => {
      await run(makeGlobalOpts());

      expect(http.apiRequest).toHaveBeenCalled();
      expect(http.apiRequest.mock.calls.map(([registry]) => registry)).toEqual(
        http.apiRequest.mock.calls.map(() => "https://clawhub.ai"),
      );
      expect(sentTokens()).toEqual(http.apiRequest.mock.calls.map(() => "saved"));
    },
  );

  it("keeps a legacy saved registry signed in and migrates it to the default registry", async () => {
    savedConfig = { registry: "https://auth.clawhub.ai", token: "saved" };
    discoverRegistryFromSite.mockResolvedValue({ apiBase: "https://clawhub.ai" });

    await cmdDownloads(makeGlobalOpts(), { json: true });

    expect(http.apiRequest).toHaveBeenCalledWith(
      "https://clawhub.ai",
      expect.objectContaining({ token: "saved" }),
      expect.anything(),
    );
    expect(savedConfig).toEqual({ registry: "https://clawhub.ai", token: "saved" });
  });

  it("does not send a legacy saved token to a discovered registry on another origin", async () => {
    savedConfig = { registry: "https://auth.clawhub.ai", token: "saved" };
    discoverRegistryFromSite.mockResolvedValue({ apiBase: "https://other.example" });

    const error = await runAndCaptureError(() =>
      cmdDownloads({ ...makeGlobalOpts(), site: "https://other.example" }, { json: true }),
    );

    expect(http.apiRequest).not.toHaveBeenCalled();
    expect(String(error)).toContain("Not logged in to this registry. Run: clawhub login");
    expect(savedConfig).toEqual({ registry: "https://auth.clawhub.ai", token: "saved" });
  });
});
