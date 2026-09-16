/* @vitest-environment node */
import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "./clawpack";
import { bundledPluginIconSourceUrl, resolvePackageIcon } from "./packageIcons";

const png = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);
const source = {
  sourceRepo: "openclaw/openclaw",
  sourceCommit: "a".repeat(40),
  sourcePath: "extensions/whatsapp",
};
function context(bytes = png) {
  return {
    storage: {
      get: vi.fn(async () => new Blob([new Uint8Array(bytes)])),
      store: vi.fn(async (_blob: Blob) => "storage:hosted"),
      delete: vi.fn(),
    },
    runQuery: vi.fn(async () => null),
    runMutation: vi.fn(async (_ref, args) => args),
    runAction: vi.fn(
      async (ref) => getFunctionName(ref) === "skillPresentationImageNode:validateRasterInternal",
    ),
  };
}
async function file(bytes = png, path = "assets/icon.png") {
  return {
    path,
    size: bytes.length,
    sha256: await sha256Hex(bytes),
    storageId: "storage:icon" as never,
    contentType: "application/octet-stream",
  };
}
afterEach(() => vi.unstubAllGlobals());

describe("package icons", () => {
  it("hosts the portable PNG with the correct MIME type", async () => {
    const ctx = context();
    expect(
      await resolvePackageIcon(ctx as never, {
        files: [await file()],
      }),
    ).toBe(`/api/v1/skill-icons/${await sha256Hex(png)}`);
    expect(ctx.storage.store.mock.calls[0]?.[0]).toHaveProperty("type", "image/png");
  });
  it("recovers an omitted official asset from the immutable source without writes during dry run", async () => {
    const fetcher = vi.fn(async () => new Response(png));
    vi.stubGlobal("fetch", fetcher);
    const ctx = context();
    const icon = await resolvePackageIcon(ctx as never, {
      files: [],
      trustedSource: source,
      dryRun: true,
    });
    expect(icon).toBe(`/api/v1/skill-icons/${await sha256Hex(png)}`);
    expect(fetcher).toHaveBeenCalledWith(
      `https://raw.githubusercontent.com/openclaw/openclaw/${source.sourceCommit}/extensions/whatsapp/assets/icon.png`,
      expect.objectContaining({ redirect: "error" }),
    );
    expect(ctx.storage.store).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });
  it("does not fetch untrusted sources, moving refs, or traversal paths", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const trustedSource of [
      undefined,
      { ...source, sourceRepo: "attacker/openclaw" },
      { ...source, sourceCommit: "main" },
      { ...source, sourcePath: "extensions/../../secrets" },
    ]) {
      expect(bundledPluginIconSourceUrl(trustedSource)).toBeUndefined();
      expect(
        await resolvePackageIcon(context() as never, {
          files: [],
          trustedSource,
        }),
      ).toBeUndefined();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("ignores nested lookalike paths and rejects tampered upload hashes", async () => {
    expect(
      await resolvePackageIcon(context() as never, {
        files: [await file(png, "nested/assets/icon.png")],
      }),
    ).toBeUndefined();
    await expect(
      resolvePackageIcon(context() as never, {
        files: [{ ...(await file()), sha256: "0".repeat(64) }],
      }),
    ).rejects.toThrow("changed during upload");
  });
  it("keeps fallback behavior for missing, malformed, oversized, or undecodable PNGs", async () => {
    for (const bytes of [new Uint8Array([1, 2, 3]), new Uint8Array(512 * 1024 + 1)]) {
      const ctx = context(bytes);
      expect(
        await resolvePackageIcon(ctx as never, { files: [await file(bytes)] }),
      ).toBeUndefined();
      expect(ctx.storage.store).not.toHaveBeenCalled();
    }
    const ctx = context();
    ctx.runAction.mockResolvedValue(false);
    expect(await resolvePackageIcon(ctx as never, { files: [await file()] })).toBeUndefined();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    expect(
      await resolvePackageIcon(ctx as never, { files: [], trustedSource: source }),
    ).toBeUndefined();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(512 * 1024 + 1))),
    );
    expect(
      await resolvePackageIcon(ctx as never, { files: [], trustedSource: source }),
    ).toBeUndefined();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await expect(
      resolvePackageIcon(ctx as never, { files: [], trustedSource: source }),
    ).rejects.toThrow("503");
  });
});
