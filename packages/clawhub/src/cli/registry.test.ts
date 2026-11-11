/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalOpts } from "./types";

const readGlobalConfig = vi.fn();
const writeGlobalConfig = vi.fn();
const discoverRegistryFromSite = vi.fn();

vi.mock("../config.js", () => ({
  readGlobalConfig: (...args: unknown[]) => readGlobalConfig(...args),
  writeGlobalConfig: (...args: unknown[]) => writeGlobalConfig(...args),
}));

vi.mock("../discovery.js", () => ({
  discoverRegistryFromSite: (...args: unknown[]) => discoverRegistryFromSite(...args),
}));

const { DEFAULT_REGISTRY, getRegistry, resolveRegistry, tokenForRegistry } =
  await import("./registry");

function makeOpts(overrides: Partial<GlobalOpts> = {}): GlobalOpts {
  return {
    workdir: "/work",
    dir: "/work/skills",
    site: "https://clawhub.ai",
    registry: DEFAULT_REGISTRY,
    registrySource: "default",
    ...overrides,
  };
}

beforeEach(() => {
  readGlobalConfig.mockReset();
  writeGlobalConfig.mockReset();
  discoverRegistryFromSite.mockReset();
});

describe("registry resolution", () => {
  it("prefers explicit registry over discovery/cache", async () => {
    readGlobalConfig.mockResolvedValue({ registry: "https://auth.clawdhub.com" });
    discoverRegistryFromSite.mockResolvedValue({ apiBase: "https://clawhub.ai" });

    const registry = await resolveRegistry(
      makeOpts({ registry: "https://custom.example", registrySource: "cli" }),
    );

    expect(registry).toBe("https://custom.example");
    expect(discoverRegistryFromSite).not.toHaveBeenCalled();
  });

  it("ignores legacy registry and updates cache from discovery", async () => {
    readGlobalConfig.mockResolvedValue({ registry: "https://auth.clawdhub.com", token: "tkn" });
    discoverRegistryFromSite.mockResolvedValue({ apiBase: "https://clawhub.ai" });

    const registry = await getRegistry(makeOpts(), { cache: true });

    expect(registry).toBe("https://clawhub.ai");
    expect(writeGlobalConfig).toHaveBeenCalledWith({
      registry: "https://clawhub.ai",
      token: "tkn",
    });
  });

  it("does not replace a legacy login when discovery names another origin", async () => {
    readGlobalConfig.mockResolvedValue({
      registry: "https://auth.clawhub.ai",
      token: "saved-marker",
    });
    discoverRegistryFromSite.mockResolvedValue({ apiBase: "http://127.0.0.1:64692" });

    const registry = await getRegistry(makeOpts({ site: "http://docs.example" }), { cache: true });

    expect(registry).toBe("http://127.0.0.1:64692");
    expect(writeGlobalConfig).not.toHaveBeenCalled();
  });

  it("does not keep a saved token when discovery names another origin", async () => {
    readGlobalConfig.mockResolvedValue({ registry: "https://clawhub.ai", token: "saved-marker" });
    discoverRegistryFromSite.mockResolvedValue({ apiBase: "https://evil.example" });

    const registry = await getRegistry(makeOpts(), { cache: true });

    expect(registry).toBe("https://evil.example");
    expect(writeGlobalConfig).not.toHaveBeenCalled();
    expect(tokenForRegistry("https://clawhub.ai", registry, "saved-marker")).toBeUndefined();
  });

  it("drops the saved token when an explicit registry changes origin", async () => {
    readGlobalConfig.mockResolvedValue({ registry: "https://clawhub.ai", token: "saved-marker" });

    const registry = await getRegistry(
      makeOpts({ registry: "https://hub.example", registrySource: "cli" }),
      { cache: true },
    );

    expect(registry).toBe("https://hub.example");
    expect(writeGlobalConfig).toHaveBeenCalledWith({
      registry: "https://hub.example",
      token: undefined,
    });
  });

  it("ignores the retired registry.clawhub.ai host", async () => {
    readGlobalConfig.mockResolvedValue({ registry: "https://registry.clawhub.ai", token: "tkn" });
    discoverRegistryFromSite.mockResolvedValue(null);

    const registry = await getRegistry(makeOpts(), { cache: true });

    expect(registry).toBe("https://clawhub.ai");
    expect(writeGlobalConfig).toHaveBeenCalledWith({
      registry: "https://clawhub.ai",
      token: "tkn",
    });
  });
});
