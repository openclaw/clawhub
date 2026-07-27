import { describe, expect, it, vi } from "vitest";
import { skillPresentationAssetHandler } from "./skillPresentationAssetsHttp";

const sha256 = "a".repeat(64);
const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const asset = {
  _id: "skillPresentationAssets:1",
  _creationTime: 1,
  sha256,
  storageId: "_storage:icon",
  contentType: "image/png",
  size: bytes.byteLength,
  createdAt: 1,
};

describe("skillPresentationAssetHandler", () => {
  it("serves immutable exact bytes with image security headers", async () => {
    const ctx = {
      runQuery: vi.fn(async () => asset),
      storage: { get: vi.fn(async () => new Blob([bytes], { type: "image/png" })) },
    };
    const response = await skillPresentationAssetHandler(
      ctx as never,
      new Request(`https://clawhub.ai/api/v1/skill-icons/${sha256}`),
    );

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("etag")).toBe(`"sha256:${sha256}"`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("returns 304 for the immutable content validator", async () => {
    const ctx = {
      runQuery: vi.fn(async () => asset),
      storage: { get: vi.fn() },
    };
    const response = await skillPresentationAssetHandler(
      ctx as never,
      new Request(`https://clawhub.ai/api/v1/skill-icons/${sha256}`, {
        headers: { "If-None-Match": `"sha256:${sha256}"` },
      }),
    );

    expect(response.status).toBe(304);
    expect(ctx.storage.get).not.toHaveBeenCalled();
  });
});
