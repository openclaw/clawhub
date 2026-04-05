import { describe, expect, it, vi } from "vitest";
import {
  formatBytes,
  formatPublishError,
  hashFile,
  isTextFile,
  readText,
  uploadFile,
} from "./uploadUtils";

describe("uploadUtils", () => {
  it("formats byte counts", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });

  it("formats publish errors from Convex-like payloads", () => {
    expect(formatPublishError({ data: "  whoops  " })).toBe("whoops");
    expect(formatPublishError({ data: { message: "  nope " } })).toBe("nope");
    expect(formatPublishError({ data: "Server Error Called by client" })).toBe(
      "Publish failed. Please try again.",
    );
  });

  it("cleans up Error messages and provides a fallback", () => {
    expect(
      formatPublishError(
        new Error("[CONVEX Q] [Request ID: 123] Server Error Called by client Bad"),
      ),
    ).toBe("Bad");
    expect(formatPublishError(new Error("ConvexError: Bad"))).toBe("Bad");
    expect(formatPublishError(new Error("Server Error"))).toBe("Publish failed. Please try again.");
    expect(formatPublishError("wat")).toBe("Publish failed. Please try again.");
  });

  it("detects text files via MIME type and extension", () => {
    expect(isTextFile(new File(["x"], "data.bin", { type: "text/plain" }))).toBe(true);
    expect(isTextFile(new File(["x"], "README.md", { type: "" }))).toBe(true);
    expect(isTextFile(new File(["x"], "image.png", { type: "" }))).toBe(false);
  });

  it("reads text from Blobs and string body fallbacks", async () => {
    expect(await readText(new Blob(["hello"]))).toBe("hello");
    expect(await readText("yo" as unknown as Blob)).toBe("yo");
  });

  it("uploads a file and returns the storage id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: "st_123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const id = await uploadFile("https://example.com/upload", new File(["x"], "x.txt"));
    expect(id).toBe("st_123");

    vi.unstubAllGlobals();
  });

  it("throws on failed uploads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => "nope",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadFile("https://example.com/upload", new File(["x"], "x.txt")),
    ).rejects.toThrow("Upload failed: nope");

    vi.unstubAllGlobals();
  });

  it("hashes files", async () => {
    const digest = await hashFile(new File(["hello"], "x.txt"));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
