import type { TemplateManifest } from "clawhub-schema";
/* @vitest-environment node */
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "./hash";
import { resolveTemplateAvatarArtwork } from "./templateAvatarArtwork";
import { renderTemplateAvatarPng } from "./templateAvatarArtworkNode";

// @anmol0b/release-notes-drafter@0.1.0, avatars/release-notes-drafter.svg.
// Copyright (c) 2026 Anmol Bhardwaj, used under the MIT License (see LICENSE).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="Release Notes Drafter">
  <rect width="128" height="128" rx="28" fill="#2b3a55"/>
  <path d="M36 28h44l14 14v58a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6V34a6 6 0 0 1 6-6z" fill="#f4f6fa"/>
  <path d="M80 28v14h14" fill="#d5dbe6"/>
  <rect x="40" y="52" width="40" height="6" rx="3" fill="#7b8aa5"/>
  <rect x="40" y="66" width="32" height="6" rx="3" fill="#9aa8bd"/>
  <rect x="40" y="80" width="36" height="6" rx="3" fill="#9aa8bd"/>
  <circle cx="88" cy="88" r="14" fill="#3c9d6b"/>
  <path d="M82 88l4 4 8-8" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
const utf8 = (text: string) => new TextEncoder().encode(text).buffer;

describe("Template avatar rendering", () => {
  it("produces a static PNG with the published Release Notes Drafter's actual colors", async () => {
    const png = await renderTemplateAvatarPng(utf8(svg), "svg");
    expect(png).not.toBeNull();
    const image = sharp(Buffer.from(png!));
    expect(await image.metadata()).toMatchObject({ format: "png", width: 128, height: 128 });
    const pixels = await image.ensureAlpha().raw().toBuffer();
    const pixel = (x: number, y: number) => [
      ...pixels.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 4),
    ];
    expect(pixel(20, 64)).toEqual([43, 58, 85, 255]); // background
    expect(pixel(50, 45)).toEqual([244, 246, 250, 255]); // paper
    expect(pixel(88, 97)).toEqual([60, 157, 107, 255]); // approval badge
  });

  it.each([
    '<image href="https://example.invalid/asset"/>',
    '<image href="file:///avatar"/>',
    '<rect fill="url(https://example.invalid/paint)"/>',
    '<rect style="fill:red"/>',
    '<use href="#recursive"/>',
    "<style/>",
    "<script/>",
    "<foreignObject/>",
    "<animate/>",
    "<svg/>",
    '<path onload="hello"/>',
    '<g xml:base="https://example.invalid/"/>',
    '<path fill="u&#114;l(other.svg)"/>',
    '<rect xmlns="urn:other"/>',
    "<g></path>",
    "<g>".repeat(14) + "</g>".repeat(14),
    '<path d="M0 0"/>'.repeat(257),
  ])("rejects unsupported SVG instead of exposing a partial image (%#)", async (markup) => {
    expect(
      await renderTemplateAvatarPng(utf8(svg.replace("</svg>", markup + "</svg>")), "svg"),
    ).toBeNull();
  });

  it("rejects declarations, oversized or malformed documents, and wrong format claims", async () => {
    for (const input of [
      "<!DOCTYPE svg>" + svg,
      '<?xml-stylesheet href="style.css"?>' + svg,
      svg.replace("128 128", "4096 4096"),
      svg.repeat(120),
      svg + "<g/>",
    ]) {
      expect(await renderTemplateAvatarPng(utf8(input), "svg")).toBeNull();
    }
    expect(await renderTemplateAvatarPng(utf8(svg), "png")).toBeNull();
    expect(await renderTemplateAvatarPng(new Uint8Array([0xff]).buffer, "svg")).toBeNull();
  });

  it.each(["png", "jpeg", "webp", "gif"] as const)(
    "decodes and bounds a static %s without serving the source",
    async (format) => {
      const source = await sharp({
        create: { width: 2048, height: 2048, channels: 3, background: "red" },
      })
        .toFormat(format)
        .toBuffer();
      const output = await renderTemplateAvatarPng(new Uint8Array(source).buffer, format);
      expect(output).not.toBeNull();
      expect(await sharp(Buffer.from(output!)).metadata()).toMatchObject({
        format: "png",
        width: 256,
        height: 256,
      });
      expect(
        await renderTemplateAvatarPng(new Uint8Array(source.subarray(0, 32)).buffer, format),
      ).toBeNull();
    },
  );

  it("never decodes oversized buffers or rasters exceeding the input pixel budget", async () => {
    const oversized = await sharp({
      create: { width: 2049, height: 2048, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    expect(await renderTemplateAvatarPng(new Uint8Array(oversized).buffer, "png")).toBeNull();
    expect(await renderTemplateAvatarPng(new Uint8Array(512 * 1024 + 1).buffer, "png")).toBeNull();
  });

  it("rejects multi-frame artwork", async () => {
    // Two-frame 1×1 RGBA APNG: libvips reports only the default image, not metadata.pages.
    const apng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAABAAAAAQAAAAAAAAAAAAEACgAAWn8w0AAAAA1JREFUeJxj+M/A8B8ABQAB/4mZPR0AAAAaZmNUTAAAAAEAAAABAAAAAQAAAAAAAAAAAAEACgAAwQzaBAAAABFmZEFUAAAAAnicY2D4z/AfAAQBAf9i5+mcAAAAAElFTkSuQmCC",
      "base64",
    );
    expect(await renderTemplateAvatarPng(new Uint8Array(apng).buffer, "png")).toBeNull();
    const animated = await sharp(Buffer.from([255, 0, 0, 0, 0, 255]), {
      raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
    })
      .gif()
      .toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    expect(await renderTemplateAvatarPng(new Uint8Array(animated).buffer, "gif")).toBeNull();
  });
});

const manifest = (
  avatar: string,
  files: { path: string; source: string }[] = [],
): TemplateManifest => ({
  schemaVersion: 1,
  agent: { id: "avatar", identity: { avatar } },
  workspace: { files },
});

function storageContext(blob: Blob | null) {
  const get = vi.fn(async () => blob);
  const store = vi.fn(async (_blob: Blob) => "stored");
  const render = vi.fn(
    async (
      _ref: unknown,
      args: { bytes: ArrayBuffer; format: Parameters<typeof renderTemplateAvatarPng>[1] },
    ) => renderTemplateAvatarPng(args.bytes, args.format),
  );
  return {
    storage: { get, store, delete: vi.fn() },
    runQuery: vi.fn(async () => null),
    runMutation: vi.fn(async (_ref: unknown, args: { storageId: string; sha256: string }) => args),
    runAction: render,
  };
}

describe("Template avatar source resolution", () => {
  const source = "archive/art.bin";
  const destination = "avatars/agent.svg";
  const mapped = manifest("Avatars/Agent.svg", [{ path: destination, source }]);
  it("reads the declared archive source, checks its digest, and derives the same URL without writes in dry run", async () => {
    const bytes = new Uint8Array(utf8(svg));
    const file = {
      path: source,
      storageId: "source",
      size: bytes.length,
      sha256: await sha256Hex(bytes),
    };
    const ctx = storageContext(new Blob([bytes], { type: "application/octet-stream" }));
    const args = {
      manifest: mapped,
      files: [{ ...file, path: destination, storageId: "decoy" }, file],
    };
    const path = await resolveTemplateAvatarArtwork(ctx as never, { ...args, dryRun: true });
    expect(ctx.storage.get).toHaveBeenCalledExactlyOnceWith("source");
    expect(ctx.storage.store).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(await resolveTemplateAvatarArtwork(ctx as never, args)).toBe(path);
    const blob = ctx.storage.store.mock.calls[0][0];
    expect(blob.type).toBe("image/png");
    expect(path).toEqual(
      "/api/v1/skill-icons/" + (await sha256Hex(new Uint8Array(await blob.arrayBuffer()))),
    );
    expect(
      await resolveTemplateAvatarArtwork(ctx as never, {
        ...args,
        files: [{ ...file, sha256: "0".repeat(64) }],
      }),
    ).toBeUndefined();
    expect(await resolveTemplateAvatarArtwork(storageContext(null) as never, args)).toBeUndefined();
  });

  it("resolves supported inline sources without reading a file", async () => {
    const ctx = storageContext(null);
    const resolve = (avatar: string) =>
      resolveTemplateAvatarArtwork(ctx as never, {
        manifest: manifest(avatar),
        files: [],
        dryRun: true,
      });
    const path = await resolve("data:image/svg+xml;base64," + btoa(svg));
    expect(path).toMatch(/^\/api\/v1\/skill-icons\/[a-f\d]{64}$/);
    expect(await resolve("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg))).toBe(path);
    expect(ctx.storage.get).not.toHaveBeenCalled();
  });

  it("skips malformed, unsupported, unbounded, non-local or undeclared sources", async () => {
    const ctx = storageContext(null);
    for (const avatar of [
      "data:image/png;base64,!!",
      "data:image/png;base64,",
      "data:image/bmp;base64,AA==",
      "data:image/svg+xml,%ZZ",
      "data:image/png;base64," + "A".repeat(700000),
      "data:image/png;base64,Af==",
      "https://example.invalid/image.png",
      "../image.png",
      "image.png",
    ]) {
      expect(
        await resolveTemplateAvatarArtwork(ctx as never, { manifest: manifest(avatar), files: [] }),
      ).toBeUndefined();
    }
    expect(ctx.storage.get).not.toHaveBeenCalled();
    expect(ctx.runAction).not.toHaveBeenCalled();
    expect(ctx.storage.store).not.toHaveBeenCalled();
  });
});
