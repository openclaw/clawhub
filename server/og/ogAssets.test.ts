/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const readFileMock = vi.fn();
const initWasmMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

vi.mock("@resvg/resvg-wasm", () => ({
  initWasm: (...args: unknown[]) => initWasmMock(...args),
}));

describe("ogAssets", () => {
  beforeEach(() => {
    delete (globalThis as { __nitro_main__?: unknown }).__nitro_main__;
    readFileMock.mockReset();
    initWasmMock.mockReset();
  });

  it("falls back to the packaged public mark asset", async () => {
    readFileMock.mockImplementation(async (input: unknown) => {
      const path = String(input);
      if (path.includes("public/clawd-mark.png")) {
        return Buffer.from("png");
      }
      if (path.includes("clawd-mark.png")) {
        throw new Error("missing root mark");
      }
      throw new Error(`unexpected read: ${path}`);
    });

    const { getMarkDataUrl } = await import("./ogAssets");

    await expect(getMarkDataUrl()).resolves.toBe("data:image/png;base64,cG5n");
    expect(readFileMock).toHaveBeenCalledTimes(2);
    expect(String(readFileMock.mock.calls[0]?.[0])).toContain("clawd-mark.png");
    expect(String(readFileMock.mock.calls[1]?.[0])).toContain("public/clawd-mark.png");
  });

  it("initializes resvg wasm only once per process", async () => {
    readFileMock.mockImplementation(async (input: unknown) => {
      const path = String(input);
      if (path.includes("index_bg.wasm")) {
        return Buffer.from([1, 2, 3]);
      }
      throw new Error(`unexpected read: ${path}`);
    });
    initWasmMock.mockResolvedValue(undefined);

    const { ensureResvgWasm } = await import("./ogAssets");

    await ensureResvgWasm();
    await ensureResvgWasm();

    expect(initWasmMock).toHaveBeenCalledTimes(1);
    expect(initWasmMock).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(String(readFileMock.mock.calls[0]?.[0])).toContain("index_bg.wasm");
  });

  it("caches font buffers across calls", async () => {
    readFileMock.mockResolvedValue(Buffer.from([9, 8, 7]));

    const { getFontBuffers } = await import("./ogAssets");

    const first = await getFontBuffers();
    const second = await getFontBuffers();

    expect(first).toHaveLength(3);
    expect(first[0]).toBeInstanceOf(Uint8Array);
    expect(second).toEqual(first);
    expect(readFileMock).toHaveBeenCalledTimes(3);
    expect(readFileMock.mock.calls.map((call) => String(call[0]))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("bricolage-grotesque-latin-800-normal.woff2"),
        expect.stringContaining("bricolage-grotesque-latin-500-normal.woff2"),
        expect.stringContaining("ibm-plex-mono-latin-500-normal.woff2"),
      ]),
    );
  });
});
