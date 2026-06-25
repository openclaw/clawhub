import { describe, expect, it } from "vitest";
import { buildPublisherOgSvg } from "./publisherOgSvg";

const transparentPixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function buildSvg(overrides: Partial<Parameters<typeof buildPublisherOgSvg>[0]> = {}) {
  return buildPublisherOgSvg({
    markDataUrl: transparentPixel,
    watermarkDataUrl: transparentPixel,
    avatarDataUrl: transparentPixel,
    title: "Matt Van Horn",
    description: "Publisher @mvanhorn on ClawHub.",
    handleLabel: "@mvanhorn",
    ...overrides,
  });
}

describe("buildPublisherOgSvg", () => {
  it("renders the no-badge no-organization creator layout", () => {
    const svg = buildSvg();
    expect(svg).toContain("Matt Van Horn");
    expect(svg).toContain("on ClawHub");
    expect(svg).toContain("Creator");
    expect(svg).toContain("@mvanhorn");
    expect(svg).toContain("Downloads");
    expect(svg).not.toContain("Publisher</text>");
    expect(svg).not.toContain("Organization");
  });

  it("renders the verified badge when official", () => {
    const svg = buildSvg({ official: true });
    expect(svg).toContain("#60A5FA");
    expect(svg).toContain('width="42" height="42"');
    expect(svg).toContain('stroke-width="1.71"');
    expect(svg).toContain("M3.85 8.62");
  });

  it("keeps the no-organization verified badge on the guide title line without shrinking text", () => {
    const svg = buildSvg({ official: true });
    expect(svg).toContain('font-size="72"');
    expect(svg).toContain('<tspan x="542" dy="0">Matt Van Horn</tspan>');
    expect(svg).toContain('<svg x="1040" y="198" width="42" height="42"');
  });

  it("keeps the organization verified badge on the guide title line", () => {
    const svg = buildSvg({ official: true, organizationLogos: [transparentPixel] });
    expect(svg).toContain('font-size="72"');
    expect(svg).toContain('<tspan x="509" dy="0">Matt Van Horn</tspan>');
    expect(svg).toContain('<svg x="1007" y="145" width="42" height="42"');
  });

  it("renders organization state when affiliations exist", () => {
    const svg = buildSvg({
      organizationLogos: [transparentPixel, transparentPixel, transparentPixel],
    });
    expect(svg).toContain("Organizations");
    expect(svg).not.toContain("OpenClaw");
    expect(svg).toContain("orgLogoClip0");
    expect(svg).toContain("orgLogoClip2");
    expect(svg).toContain('width="48" height="48" clip-path="url(#orgLogoClip0)"');
    expect(svg).toContain('width="48" height="48" clip-path="url(#orgLogoClip2)"');
    expect(svg).not.toContain('rx="8" fill="#F7F1EA"');
  });

  it("caps rendered organization logos at five", () => {
    const svg = buildSvg({
      organizationLogos: [
        transparentPixel,
        transparentPixel,
        transparentPixel,
        transparentPixel,
        transparentPixel,
        transparentPixel,
      ],
    });
    expect(svg).toContain("orgLogoClip4");
    expect(svg).not.toContain("orgLogoClip5");
  });

  it("keeps long publisher names left aligned and within the content column", () => {
    const svg = buildSvg({
      official: true,
      title: "Matt Van Horn lalalallalalalalalallallalalalalalalalala",
      handleLabel: "@mvanhornfgfgfgfgfggfgfgfgfgfgsd",
      organizationLogos: [
        transparentPixel,
        transparentPixel,
        transparentPixel,
        transparentPixel,
        transparentPixel,
      ],
      stats: [{ label: "Downloads", value: "41.9k" }],
    });
    expect(svg).not.toContain('text-anchor="middle"');
    expect(svg).toContain('<tspan x="447" dy="0">');
    expect(svg).toContain("Matt Van Horn");
    expect(svg).not.toContain("lalalallalalalalalallallalalalalalalalala</tspan>");
    expect(svg).toContain("#60A5FA");
    expect(svg).toContain('font-size="46"');
    expect(svg).toMatch(/@mvanhornfgfgfgfgfgg.*\.\.\./);
    expect(svg).toContain("...");
    expect(svg).not.toContain("…");
    expect(svg).toContain('x="110" y="500" width="48" height="48"');
    expect(svg).toContain('x="447" y="547"');
    expect(svg).toContain(">41.9k</text>");
  });
});
