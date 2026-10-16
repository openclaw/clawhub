/* @vitest-environment node */
import type { ClawManifest } from "clawhub-schema";
import { getFunctionName } from "convex/server";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { resolveClawIcon } from "./clawIcons";
import { sha256Hex } from "./clawpack";

const png = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);
const manifest = (avatar?: string): ClawManifest => ({
  schemaVersion: 1,
  agent: { id: "gardener", identity: { avatar } },
});
function context(bytes = png) {
  return {
    storage: {
      get: vi.fn(async () => new Blob([new Uint8Array(bytes)])),
      store: vi.fn(async (_blob: Blob) => "storage:hosted"),
      delete: vi.fn(),
    },
    runQuery: vi.fn(async () => null),
    runMutation: vi.fn(async (_ref, args) => args),
    runAction: vi.fn(async (ref, args) => {
      expect(getFunctionName(ref)).toBe("skillPresentationImageNode:validateRasterInternal");
      await sharp(Buffer.from(args.bytes)).raw().toBuffer();
      return true;
    }),
  };
}

describe("Claw listing identity", () => {
  it("hosts the exact selected avatar bytes from a data URL", async () => {
    const ctx = context();
    expect(
      await resolveClawIcon(
        ctx as never,
        manifest(`data:image/png;base64,${Buffer.from(png).toString("base64")}`),
        [],
      ),
    ).toBe(`/api/v1/skill-icons/${await sha256Hex(png)}`);
    expect(ctx.storage.get).not.toHaveBeenCalled();
    const stored = ctx.storage.store.mock.calls[0][0];
    expect(stored.type).toBe("image/png");
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(png);
  });

  it("uses the declared workspace source, including portable destination casing", async () => {
    const ctx = context();
    const claw = {
      ...manifest("Avatars/GARDENER.png"),
      workspace: { files: [{ source: "assets/selected.bin", path: "avatars/gardener.png" }] },
    };
    const files = [
      {
        path: "assets/selected.bin",
        size: png.length,
        sha256: await sha256Hex(png),
        storageId: "storage:selected",
      },
    ];
    expect(await resolveClawIcon(ctx as never, claw, files)).toBe(
      `/api/v1/skill-icons/${await sha256Hex(png)}`,
    );
    expect(ctx.storage.get).toHaveBeenCalledWith("storage:selected");
    await expect(
      resolveClawIcon(ctx as never, claw, [{ ...files[0], sha256: "0".repeat(64) }]),
    ).rejects.toThrow("changed during upload");
  });

  it.each([false, true])(
    "preserves an SVG data URL with charset metadata and base64=%s",
    async (base64) => {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#FFAA00"/></svg>';
      const bytes = new TextEncoder().encode(svg);
      const payload = base64 ? Buffer.from(bytes).toString("base64") : encodeURIComponent(svg);
      const avatar = `data:image/svg+xml;charset=utf-8${base64 ? ";base64" : ""},${payload}`;
      const ctx = context();
      expect(await resolveClawIcon(ctx as never, manifest(avatar), [])).toBe(
        `/api/v1/skill-icons/${await sha256Hex(bytes)}`,
      );
      expect(new Uint8Array(await ctx.storage.store.mock.calls[0][0].arrayBuffer())).toEqual(bytes);
    },
  );

  it("does not fetch remote images or fall back to a second package icon", async () => {
    const ctx = context();
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      for (const avatar of [
        undefined,
        "https://example.invalid/avatar.png",
        "data:image/png;base64,garbage",
        "missing.png",
      ]) {
        expect(
          await resolveClawIcon(ctx as never, manifest(avatar), [
            {
              path: "assets/icon.png",
              size: png.length,
              sha256: await sha256Hex(png),
              storageId: "storage:wrong",
            },
          ]),
        ).toBeUndefined();
      }
      expect(ctx.storage.store).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });
});
