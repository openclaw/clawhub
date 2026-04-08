import { join } from "node:path";
import { vi } from "vitest";
import type { GlobalOpts } from "../src/cli/types.js";

export function makeGlobalOpts(workdir = "/work"): GlobalOpts {
  return {
    workdir,
    dir: join(workdir, "skills"),
    site: "https://clawhub.ai",
    registry: "https://clawhub.ai",
    registrySource: "default",
  };
}

function buildRegistryUrl(path: string, registry: string) {
  const base = registry.endsWith("/") ? registry : `${registry}/`;
  const relative = path.startsWith("/") ? path.slice(1) : path;
  return new URL(relative, base);
}

export function createHttpModuleMocks() {
  const apiRequest = vi.fn();
  const apiRequestForm = vi.fn();
  const downloadZip = vi.fn();
  const fetchText = vi.fn();
  const registryUrl = vi.fn(buildRegistryUrl);

  return {
    apiRequest,
    apiRequestForm,
    downloadZip,
    fetchText,
    registryUrl,
    moduleFactory: () => ({
      apiRequest: (registry: unknown, args: unknown, schema?: unknown) =>
        apiRequest(registry, args, schema),
      apiRequestForm: (registry: unknown, args: unknown, schema?: unknown) =>
        apiRequestForm(registry, args, schema),
      downloadZip: (registry: unknown, args: unknown) => downloadZip(registry, args),
      fetchText: (registry: unknown, args: unknown) => fetchText(registry, args),
      registryUrl: (...args: [string, string]) => registryUrl(...args),
    }),
  };
}

export function createRegistryModuleMocks() {
  const getRegistry = vi.fn(async (_opts?: unknown, _params?: unknown) => "https://clawhub.ai");

  return {
    getRegistry,
    moduleFactory: () => ({
      getRegistry: (opts: unknown, params?: unknown) => getRegistry(opts, params),
    }),
  };
}

export function createAuthTokenModuleMocks() {
  const requireAuthToken = vi.fn(async () => "tkn");
  const getOptionalAuthToken = vi.fn(async () => undefined as string | undefined);

  return {
    requireAuthToken,
    getOptionalAuthToken,
    moduleFactory: () => ({
      requireAuthToken: () => requireAuthToken(),
      getOptionalAuthToken: () => getOptionalAuthToken(),
    }),
  };
}

export function createUiModuleMocks(options?: { interactive?: boolean }) {
  const spinner = {
    stop: vi.fn(),
    fail: vi.fn(),
    succeed: vi.fn(),
    start: vi.fn(),
    isSpinning: false,
    text: "",
  };
  const fail = vi.fn((message: string) => {
    throw new Error(message);
  });
  const promptConfirm = vi.fn(async () => true);
  const interactive = options?.interactive ?? false;

  return {
    spinner,
    fail,
    promptConfirm,
    moduleFactory: () => ({
      createSpinner: vi.fn(() => spinner),
      fail: (message: string) => fail(message),
      formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
      isInteractive: () => interactive,
      promptConfirm,
    }),
  };
}
