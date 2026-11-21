/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import { readOptionalTextFile, readStorageText } from "./storageText";

function context(blob: Blob | null) {
  const get = vi.fn(async () => blob);
  const unexpected = async () => {
    throw new Error("Unexpected storage operation");
  };
  const ctx: Pick<ActionCtx, "storage"> = {
    storage: {
      get,
      getUrl: unexpected,
      getMetadata: unexpected,
      generateUploadUrl: unexpected,
      delete: unexpected,
      store: unexpected,
    },
  };
  return { get, ctx };
}

describe("package storage text", () => {
  it("keeps permissive reads distinct from strict UTF-8 publication reads", async () => {
    const blob = new Blob([new Uint8Array([0xc3, 0x28])]);
    const { ctx } = context(blob);
    expect(await readStorageText(ctx, "stored")).toBe("\ufffd(");
    await expect(
      readStorageText(ctx, "stored", { strictUtf8: true, label: "Plugin manifest" }),
    ).rejects.toThrow("Plugin manifest must be valid UTF-8");
  });

  it("checks missing storage and byte limits before decoding", async () => {
    const missing = context(null);
    await expect(
      readStorageText(missing.ctx, "gone", { maxBytes: 0, strictUtf8: true }),
    ).rejects.toThrow("Uploaded file no longer exists");
    const blob = new Blob([new Uint8Array([0xc3, 0x28])]);
    const arrayBuffer = vi.spyOn(blob, "arrayBuffer");
    const { ctx } = context(blob);
    await expect(
      readStorageText(ctx, "stored", { maxBytes: 1, strictUtf8: true, label: "Plugin manifest" }),
    ).rejects.toThrow("Plugin manifest exceeds byte limit");
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(await readStorageText(ctx, "stored", { maxBytes: 2 })).toBe("\ufffd(");
  });

  it("returns the original first matching file and preserves exact path selection", async () => {
    const files = [
      { path: "README.md", storageId: "first", sha256: "first-hash" },
      { path: "readme.md", storageId: "second", sha256: "second-hash" },
    ];
    const { ctx, get } = context(new Blob(["text"]));
    const folded = await readOptionalTextFile(ctx, files, (path) => path === "readme.md");
    expect(folded?.file).toBe(files[0]);
    expect(folded?.file.sha256).toBe("first-hash");
    expect(get).toHaveBeenLastCalledWith("first");
    const exact = await readOptionalTextFile(ctx, files, (path) => path === "readme.md", {
      exactPath: true,
    });
    expect(exact?.file).toBe(files[1]);
    expect(get).toHaveBeenLastCalledWith("second");
    get.mockClear();
    expect(await readOptionalTextFile(ctx, files, (path) => path === "missing")).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
