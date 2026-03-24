/* @vitest-environment node */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const bunRuntimeMocks = vi.hoisted(() => {
  const originalBunVersion = (process.versions as Record<string, string | undefined>).bun;
  Object.defineProperty(process.versions, "bun", {
    value: "1.2.3",
    configurable: true,
  });

  return {
    originalBunVersion,
    spawnSync: vi.fn(),
    mkdir: vi.fn(async () => undefined),
    mkdtemp: vi.fn(async () => "/tmp/clawhub-test"),
    rm: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => Buffer.from([1, 2, 3]) as Buffer<ArrayBuffer>),
  };
});

vi.mock("node:child_process", () => ({
  spawnSync: bunRuntimeMocks.spawnSync,
}));

vi.mock("node:fs/promises", () => ({
  mkdir: bunRuntimeMocks.mkdir,
  mkdtemp: bunRuntimeMocks.mkdtemp,
  rm: bunRuntimeMocks.rm,
  writeFile: bunRuntimeMocks.writeFile,
  readFile: bunRuntimeMocks.readFile,
}));

import * as http from "./http";

function restoreBunRuntime() {
  if (bunRuntimeMocks.originalBunVersion === undefined) {
    Reflect.deleteProperty(process.versions, "bun");
    return;
  }
  Object.defineProperty(process.versions, "bun", {
    value: bunRuntimeMocks.originalBunVersion,
    configurable: true,
  });
}

function mockImmediateTimeouts() {
  const setTimeoutMock = vi.fn((callback: () => void) => {
    callback();
    return 1 as unknown as ReturnType<typeof setTimeout>;
  });
  const clearTimeoutMock = vi.fn();
  vi.stubGlobal("setTimeout", setTimeoutMock as unknown as typeof setTimeout);
  vi.stubGlobal("clearTimeout", clearTimeoutMock as typeof clearTimeout);
  return { setTimeoutMock, clearTimeoutMock };
}

type SpawnImpl = (...args: unknown[]) => unknown;

async function loadHttpModuleWithBunMocks(opts?: {
  spawnImpl?: SpawnImpl;
  mkdtempValue?: string;
  readFileValue?: Buffer | null;
}) {
  const spawnSync: SpawnImpl = opts?.spawnImpl ?? vi.fn();
  bunRuntimeMocks.spawnSync.mockImplementation((...args: unknown[]) => spawnSync(...args));
  bunRuntimeMocks.mkdir.mockImplementation(async () => undefined);
  bunRuntimeMocks.mkdtemp.mockImplementation(async () => opts?.mkdtempValue ?? "/tmp/clawhub-test");
  bunRuntimeMocks.rm.mockImplementation(async () => undefined);
  bunRuntimeMocks.writeFile.mockImplementation(async () => undefined);
  bunRuntimeMocks.readFile.mockImplementation(
    async () => (opts?.readFileValue ?? Buffer.from([1, 2, 3])) as Buffer<ArrayBuffer>,
  );

  return {
    http,
    spawnSync: bunRuntimeMocks.spawnSync,
    mkdir: bunRuntimeMocks.mkdir,
    mkdtemp: bunRuntimeMocks.mkdtemp,
    rm: bunRuntimeMocks.rm,
    writeFile: bunRuntimeMocks.writeFile,
    readFile: bunRuntimeMocks.readFile,
  };
}

describe("http bun runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(process.versions, "bun", {
      value: "1.2.3",
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    restoreBunRuntime();
  });

  it("uses curl for apiRequest GET and parses JSON", async () => {
    const spawnSync = vi.fn().mockReturnValue({
      status: 0,
      stdout: '{"ok":true}\n200',
      stderr: "",
    });
    const { http: httpClient } = await loadHttpModuleWithBunMocks({ spawnImpl: spawnSync });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await httpClient.apiRequest<{ ok: boolean }>("https://registry.example", {
      method: "GET",
      path: "/v1/ping",
      token: "clh_token",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(spawnSync).toHaveBeenCalledTimes(1);
    const [, args] = spawnSync.mock.calls[0] as [string, string[]];
    expect(args).toContain("GET");
    expect(args).toContain("https://registry.example/v1/ping");
    expect(args).toContain("Accept: application/json");
    expect(args).toContain("Authorization: Bearer clh_token");
  }, 10_000);

  it("uses curl for apiRequest POST with json body", async () => {
    const spawnSync = vi.fn().mockReturnValue({
      status: 0,
      stdout: '{"ok":true}\n200',
      stderr: "",
    });
    const { http: httpClient } = await loadHttpModuleWithBunMocks({ spawnImpl: spawnSync });

    await httpClient.apiRequest("https://registry.example", {
      method: "POST",
      path: "/v1/ping",
      body: { a: 1 },
    });

    const [, args] = spawnSync.mock.calls[0] as [string, string[]];
    expect(args).toContain("Content-Type: application/json");
    expect(args).toContain("--data-binary");
    expect(args).toContain('{"a":1}');
  });

  it("retries bun apiRequest on 429 errors", async () => {
    const spawnSync = vi.fn().mockReturnValue({
      status: 0,
      stdout: "rate limited\n429",
      stderr: "",
    });
    const { http: httpClient } = await loadHttpModuleWithBunMocks({ spawnImpl: spawnSync });

    await expect(
      httpClient.apiRequest("https://registry.example", {
        method: "GET",
        path: "/v1/ping",
      }),
    ).rejects.toThrow("rate limited");

    expect(spawnSync).toHaveBeenCalledTimes(3);
  });

  it("includes rate-limit guidance from curl metadata on 429", async () => {
    mockImmediateTimeouts();
    const spawnSync = vi.fn().mockReturnValue({
      status: 0,
      stdout: "rate limited\n__CLAWHUB_CURL_META__\n429\n20\n0\n1771404540\n20\n0\n34\n34\n",
      stderr: "",
    });
    const { http: httpClient } = await loadHttpModuleWithBunMocks({ spawnImpl: spawnSync });

    await expect(
      httpClient.apiRequest("https://registry.example", {
        method: "GET",
        path: "/v1/ping",
      }),
    ).rejects.toThrow(/retry in 34s.*remaining: 0\/20.*reset in 34s/i);

    expect(spawnSync).toHaveBeenCalledTimes(3);
  });

  it("does not retry bun apiRequest on 404 errors", async () => {
    const spawnSync = vi.fn().mockReturnValue({
      status: 0,
      stdout: "missing\n404",
      stderr: "",
    });
    const { http: httpClient } = await loadHttpModuleWithBunMocks({ spawnImpl: spawnSync });

    await expect(
      httpClient.apiRequest("https://registry.example", {
        method: "GET",
        path: "/v1/ping",
      }),
    ).rejects.toThrow("missing");

    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it("supports fetchText bun path and propagates status fallback", async () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "hello world\n200",
        stderr: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "\n400",
        stderr: "",
      });
    const { http: httpClient } = await loadHttpModuleWithBunMocks({ spawnImpl: spawnSync });

    const text = await httpClient.fetchText("https://registry.example", { path: "/v1/readme" });
    expect(text).toBe("hello world");

    await expect(
      httpClient.fetchText("https://registry.example", { path: "/v1/readme" }),
    ).rejects.toThrow("HTTP 400");
  });

  it("handles downloadZip bun path and cleans up temp dir", async () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "200",
        stderr: "",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "404",
        stderr: "",
      });
    const {
      http: httpClient,
      rm,
      readFile,
    } = await loadHttpModuleWithBunMocks({
      spawnImpl: spawnSync,
      mkdtempValue: "/tmp/clawhub-download-abc",
      readFileValue: Buffer.from("not found"),
    });

    const bytes = await httpClient.downloadZip("https://registry.example", {
      slug: "demo",
      token: "t",
    });
    expect(Array.from(bytes)).toEqual(Array.from(Buffer.from("not found")));

    await expect(
      httpClient.downloadZip("https://registry.example", { slug: "demo", token: "t" }),
    ).rejects.toThrow("not found");

    expect(readFile).toHaveBeenCalled();
    expect(rm).toHaveBeenCalledWith("/tmp/clawhub-download-abc", {
      recursive: true,
      force: true,
    });
  });

  it("posts multipart form via curl in bun path", async () => {
    const spawnSync = vi.fn().mockReturnValue({
      status: 0,
      stdout: '{"ok":true}\n200',
      stderr: "",
    });
    const {
      http: httpClient,
      mkdir,
      writeFile,
      rm,
    } = await loadHttpModuleWithBunMocks({
      spawnImpl: spawnSync,
      mkdtempValue: "/tmp/clawhub-upload-abc",
    });

    const form = new FormData();
    form.append("name", "demo");
    form.append("file", new Blob(["abc"], { type: "text/plain" }), "dist/demo.txt");

    const result = await httpClient.apiRequestForm<{ ok: boolean }>("https://registry.example", {
      method: "POST",
      path: "/upload",
      form,
    });

    expect(result).toEqual({ ok: true });
    expect(mkdir).toHaveBeenCalledWith("/tmp/clawhub-upload-abc/dist", { recursive: true });
    expect(writeFile).toHaveBeenCalled();
    expect(rm).toHaveBeenCalledWith("/tmp/clawhub-upload-abc", { recursive: true, force: true });
    const [, args] = spawnSync.mock.calls[0] as [string, string[]];
    expect(args).toContain("-F");
    expect(args.some((arg) => arg.includes("name=demo"))).toBe(true);
    expect(args.some((arg) => arg.includes("file=@/tmp/clawhub-upload-abc/dist/demo.txt"))).toBe(true);
  });
});
