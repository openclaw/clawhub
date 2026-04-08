/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "./http.js";

type SpawnResult = {
  status: number | null;
  stdout?: string;
  stderr?: string;
};

function createBunClient(options?: {
  spawnImpl?: (...args: unknown[]) => SpawnResult;
  mkdtempValue?: string;
  readFileValue?: Buffer | null;
}) {
  const spawnImpl = vi.fn(options?.spawnImpl ?? (() => ({ status: 0, stdout: "", stderr: "" })));
  const mkdirImpl = vi.fn(async () => undefined);
  const mkdtempImpl = vi.fn(async () => options?.mkdtempValue ?? "/tmp/clawhub-test");
  const rmImpl = vi.fn(async () => undefined);
  const writeFileImpl = vi.fn(async () => undefined);
  const readFileImpl = vi.fn(
    async () => (options?.readFileValue ?? Buffer.from([1, 2, 3])) as Buffer<ArrayBuffer>,
  );
  const setTimeoutImpl = vi.fn((callback: () => void, _ms?: number) => {
    callback();
    return 1 as unknown as ReturnType<typeof setTimeout>;
  });
  const clearTimeoutImpl = vi.fn();

  return {
    client: createHttpClient({
      runtime: "bun",
      configureDispatcher: false,
      spawnSyncImpl: spawnImpl as unknown as typeof import("node:child_process").spawnSync,
      mkdirImpl: mkdirImpl as unknown as typeof import("node:fs/promises").mkdir,
      mkdtempImpl: mkdtempImpl as unknown as typeof import("node:fs/promises").mkdtemp,
      rmImpl: rmImpl as unknown as typeof import("node:fs/promises").rm,
      writeFileImpl: writeFileImpl as unknown as typeof import("node:fs/promises").writeFile,
      readFileImpl: readFileImpl as unknown as typeof import("node:fs/promises").readFile,
      setTimeoutImpl: setTimeoutImpl as unknown as typeof setTimeout,
      clearTimeoutImpl,
      tmpdirPath: "/tmp",
      random: () => 0,
    }),
    spawnImpl,
    mkdirImpl,
    mkdtempImpl,
    rmImpl,
    writeFileImpl,
    readFileImpl,
    setTimeoutImpl,
    clearTimeoutImpl,
  };
}

describe("bun http client", () => {
  it("uses curl for apiRequest GET and POST", async () => {
    const { client, spawnImpl } = createBunClient({
      spawnImpl: () => ({ status: 0, stdout: '{"ok":true}\n200', stderr: "" }),
    });

    const getResult = await client.apiRequest<{ ok: boolean }>("https://registry.example", {
      method: "GET",
      path: "/v1/ping",
      token: "clh_token",
    });
    await client.apiRequest("https://registry.example", {
      method: "POST",
      path: "/v1/ping",
      body: { a: 1 },
    });

    expect(getResult).toEqual({ ok: true });
    const [, getArgs] = spawnImpl.mock.calls[0] as [string, string[]];
    expect(getArgs).toContain("GET");
    expect(getArgs).toContain("https://registry.example/v1/ping");
    expect(getArgs).toContain("Authorization: Bearer clh_token");

    const [, postArgs] = spawnImpl.mock.calls[1] as [string, string[]];
    expect(postArgs).toContain("Content-Type: application/json");
    expect(postArgs).toContain("--data-binary");
    expect(postArgs).toContain('{"a":1}');
  });

  it("retries 429 responses and keeps 404 non-retryable", async () => {
    const rateLimited = createBunClient({
      spawnImpl: () => ({ status: 0, stdout: "rate limited\n429", stderr: "" }),
    });

    await expect(
      rateLimited.client.apiRequest("https://registry.example", {
        method: "GET",
        path: "/v1/ping",
      }),
    ).rejects.toThrow("rate limited");
    expect(rateLimited.spawnImpl).toHaveBeenCalledTimes(3);

    const missing = createBunClient({
      spawnImpl: () => ({ status: 0, stdout: "missing\n404", stderr: "" }),
    });
    await expect(
      missing.client.apiRequest("https://registry.example", {
        method: "GET",
        path: "/v1/ping",
      }),
    ).rejects.toThrow("missing");
    expect(missing.spawnImpl).toHaveBeenCalledTimes(1);
  });

  it("includes curl rate-limit metadata in 429 errors", async () => {
    const { client, spawnImpl } = createBunClient({
      spawnImpl: () => ({
        status: 0,
        stdout: "rate limited\n__CLAWHUB_CURL_META__\n429\n20\n0\n1771404540\n20\n0\n34\n34\n",
        stderr: "",
      }),
    });

    await expect(
      client.apiRequest("https://registry.example", {
        method: "GET",
        path: "/v1/ping",
      }),
    ).rejects.toThrow(/retry in 34s.*remaining: 0\/20.*reset in 34s/i);
    expect(spawnImpl).toHaveBeenCalledTimes(3);
  });

  it("supports fetchText and downloadZip via curl", async () => {
    const { client, spawnImpl, readFileImpl, rmImpl } = createBunClient({
      spawnImpl: vi
        .fn()
        .mockReturnValueOnce({ status: 0, stdout: "hello world\n200", stderr: "" })
        .mockReturnValueOnce({ status: 0, stdout: "200", stderr: "" })
        .mockReturnValueOnce({ status: 0, stdout: "404", stderr: "" }),
      mkdtempValue: "/tmp/clawhub-download-abc",
      readFileValue: Buffer.from("not found"),
    });

    await expect(
      client.fetchText("https://registry.example", { path: "/v1/readme" }),
    ).resolves.toBe("hello world");
    const bytes = await client.downloadZip("https://registry.example", {
      slug: "demo",
      token: "t",
    });
    expect(Array.from(bytes)).toEqual(Array.from(Buffer.from("not found")));
    await expect(
      client.downloadZip("https://registry.example", { slug: "demo", token: "t" }),
    ).rejects.toThrow("not found");

    expect(readFileImpl).toHaveBeenCalled();
    expect(rmImpl).toHaveBeenCalledWith("/tmp/clawhub-download-abc", {
      recursive: true,
      force: true,
    });
    expect(spawnImpl).toHaveBeenCalledTimes(3);
  });

  it("posts multipart form data via curl and cleans up temp files", async () => {
    const { client, spawnImpl, mkdirImpl, writeFileImpl, rmImpl } = createBunClient({
      spawnImpl: () => ({ status: 0, stdout: '{"ok":true}\n200', stderr: "" }),
      mkdtempValue: "/tmp/clawhub-upload-abc",
    });

    const form = new FormData();
    form.append("name", "demo");
    form.append("file", new Blob(["abc"], { type: "text/plain" }), "dist/demo.txt");

    const result = await client.apiRequestForm<{ ok: boolean }>("https://registry.example", {
      method: "POST",
      path: "/upload",
      form,
    });

    expect(result).toEqual({ ok: true });
    expect(mkdirImpl).toHaveBeenCalledWith("/tmp/clawhub-upload-abc/dist", { recursive: true });
    expect(writeFileImpl).toHaveBeenCalled();
    expect(rmImpl).toHaveBeenCalledWith("/tmp/clawhub-upload-abc", {
      recursive: true,
      force: true,
    });
    const [, args] = spawnImpl.mock.calls[0] as [string, string[]];
    expect(args).toContain("-F");
    expect(args.some((arg) => arg.includes("name=demo"))).toBe(true);
    expect(args.some((arg) => arg.includes("file=@/tmp/clawhub-upload-abc/dist/demo.txt"))).toBe(
      true,
    );
  });
});
