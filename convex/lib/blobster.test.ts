/* @vitest-environment node */
import { readFileSync, readdirSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { renderBlobster } from "./blobster";

const plain = {
  version: 1,
  id: "garden-keeper",
  name: "Garden Keeper",
  description: "A gardener",
  palette: { shell: "#87b891", claw: "#5b9471", glint: "#fff0b3" },
  layers: { back: "", left_prop: "", right_prop: "", shell_overlay: "", accessory: "" },
};

describe("Blobster renderer", () => {
  const fixtures = new URL("./blobster-fixtures/", import.meta.url);
  for (const filename of readdirSync(fixtures).filter((file) => file.endsWith(".json"))) {
    it(`renders ${filename} at tiny and detail sizes`, async () => {
      const fixture = JSON.parse(readFileSync(new URL(filename, fixtures), "utf8"));
      // The service keeps one square canvas rather than accepting model-controlled bounds.
      const { bounds: _bounds, ...design } = fixture;
      const { svg } = renderBlobster({ ...design, layers: { ...plain.layers, ...design.layers } });
      for (const size of [24, 256]) {
        const rendered = await sharp(Buffer.from(svg))
          .resize(size, size)
          .ensureAlpha()
          .raw()
          .toBuffer();
        const alpha = [...rendered].filter((_, index) => index % 4 === 3);
        expect(alpha.filter((value) => value > 0).length).toBeGreaterThan(size * size * 0.25);
        expect(alpha.some((value) => value === 0)).toBe(true);
      }
      expect(svg).toContain("Copyright (c) 2026 OpenClaw Foundation");
    });
  }

  it.each([
    "<script>alert(1)</script>",
    '<image href="https://evil.invalid/a.png"/>',
    "<foreignObject><p>Hi</p></foreignObject>",
    '<use href="#body"/>',
    '<path d="M0 0" onload="alert(1)"/>',
    '<path d="M0 0" style="fill:red"/>',
    '<path d="M0 0" fill="url(https://evil.invalid)"/>',
    '<g xmlns="http://evil.invalid"/>',
    "<!--hidden-->",
    '<?xml version="1.0"?>',
    "<!DOCTYPE svg>",
    '<circle cx="1e309"/>',
    '<circle cx="999999999"/>',
    '<path d="M1e309 0"/>',
    '<g transform="translate(1e309 0)"/>',
    '<path opacity="2"/>',
    "<g>text</g>",
    '</svg><svg><path d="M0 0"/>',
    "<g>".repeat(14) + "</g>".repeat(14),
    '<circle r="2"/>'.repeat(129),
    '<circle fill="&#117;rl(evil)"/>',
  ])("rejects active or unbounded SVG: %s", (accessory) => {
    expect(() => renderBlobster({ ...plain, layers: { ...plain.layers, accessory } })).toThrow();
  });

  it("escapes metadata and retains a fixed face and square canvas", () => {
    const { svg } = renderBlobster({ ...plain, name: '<script>&"', description: "A 🦞" });
    expect(svg).toContain("&lt;script&gt;&amp;&quot;");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain('viewBox="-12 -18 144 144"');
    expect(svg).toContain('<circle cx="45" cy="32" r="5.5"');
    expect(() => renderBlobster({ ...plain, name: "\ud800" })).toThrow();
    expect(() =>
      renderBlobster({ ...plain, palette: { ...plain.palette, shell: "red" } }),
    ).toThrow();
    expect(() => renderBlobster({ ...plain, bounds: [0, 0, 1, 1] })).toThrow();
  });
});
