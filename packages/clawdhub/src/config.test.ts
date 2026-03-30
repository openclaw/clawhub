/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEnvStubRegistry } from "../test/runtimeStubs.js";

const fsMocks = vi.hoisted(() => ({
  chmod: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    chmod: fsMocks.chmod,
    mkdir: fsMocks.mkdir,
    readFile: fsMocks.readFile,
    writeFile: fsMocks.writeFile,
  };
});

const configModuleSpecifier = "./config.js?config-test" as string;

const { writeGlobalConfig } = (await import(configModuleSpecifier)) as typeof import("./config");

const originalPlatform = process.platform;
const testConfigPath = "/tmp/clawhub-config-test/config.json";
const envStubs = createEnvStubRegistry();

function makeErr(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

beforeEach(() => {
  envStubs.stub("CLAWHUB_CONFIG_PATH", testConfigPath);
  Object.defineProperty(process, "platform", { value: "linux" });
  fsMocks.chmod.mockResolvedValue(undefined);
  fsMocks.mkdir.mockResolvedValue(undefined);
  fsMocks.readFile.mockResolvedValue("");
  fsMocks.writeFile.mockResolvedValue(undefined);
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
  envStubs.restoreAll();
  vi.clearAllMocks();
  fsMocks.chmod.mockReset();
  fsMocks.mkdir.mockReset();
  fsMocks.readFile.mockReset();
  fsMocks.writeFile.mockReset();
});

describe("writeGlobalConfig", () => {
  it("writes config with restricted modes", async () => {
    await writeGlobalConfig({ registry: "https://example.com", token: "clh_test" });

    expect(fsMocks.mkdir).toHaveBeenCalledWith("/tmp/clawhub-config-test", {
      recursive: true,
      mode: 0o700,
    });
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      testConfigPath,
      expect.stringContaining('"token": "clh_test"'),
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    expect(fsMocks.chmod).toHaveBeenCalledWith(testConfigPath, 0o600);
  });

  it("ignores non-fatal chmod errors", async () => {
    fsMocks.chmod.mockRejectedValueOnce(makeErr("ENOTSUP"));

    await expect(writeGlobalConfig({ registry: "https://example.com" })).resolves.toBeUndefined();
  });

  it("rethrows unexpected chmod errors", async () => {
    fsMocks.chmod.mockRejectedValueOnce(new Error("boom"));

    await expect(writeGlobalConfig({ registry: "https://example.com" })).rejects.toThrow("boom");
  });
});
