import { describe, expect, it } from "vitest";
import { buildPublisherOgSvg } from "./publisherOgSvg";

const transparentPixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const clawHubLogoDataUrl = "data:image/png;base64,Y2xhd2h1Yi1sb2dv";

function readOfficialBadgeX(svg: string) {
  const match = /<svg x="([^"]+)" y="[^"]+" width="42" height="42"/.exec(svg);
  return match ? Number.parseFloat(match[1]) : null;
}

function readTitleLastLine(svg: string) {
  const matches = [...svg.matchAll(/<tspan x="[^"]+" dy="[^"]+">([^<]+)<\/tspan>/g)];
  return matches.at(-1)?.[1] ?? "";
}

function buildSvg(overrides: Partial<Parameters<typeof buildPublisherOgSvg>[0]> = {}) {
  return buildPublisherOgSvg({
    clawHubLogoDataUrl,
    avatarDataUrl: transparentPixel,
    title: "Matt Van Horn",
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

  it("always renders the fixed ClawHub logo next to the ClawHub header text", () => {
    const svg = buildSvg({
      avatarDataUrl: "data:image/png;base64,YXZhdGFy",
      organizationLogos: ["data:image/png;base64,b3Jn"],
    });

    expect(svg).toContain(
      `<image href="${clawHubLogoDataUrl}" x="958" y="34" width="44" height="44"`,
    );
    expect(svg).toContain(">ClawHub</text>");
    expect(svg).not.toContain('<image href="data:image/png;base64,YXZhdGFy" x="958" y="34"');
    expect(svg).not.toContain('<image href="data:image/png;base64,b3Jn" x="958" y="34"');
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
    expect(svg).toContain('font-family="Bricolage Grotesque, sans-serif"');
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain('fill="#BB3D34"');
    expect(svg).toContain('gradientTransform="translate(96 84) rotate(24) scale(440 240)"');
    expect(svg).toContain('stop-color="#7F1D2D" stop-opacity="0.2"');
    expect(svg).toContain('stop-color="#6C1B2B" stop-opacity="0"');
    expect(svg).not.toContain("#D4453A");
    expect(svg).toContain('<tspan x="542" dy="0">Matt Van Horn</tspan>');
    expect(svg).toContain('<svg x="1061.33" y="198.24" width="42" height="42"');
  });

  it("keeps the organization verified badge on the guide title line", () => {
    const svg = buildSvg({ official: true, organizationLogos: [transparentPixel] });
    expect(svg).toContain('font-size="72"');
    expect(svg).toContain('<tspan x="509" dy="0">Matt Van Horn</tspan>');
    expect(svg).toContain('<svg x="1028.33" y="145.24" width="42" height="42"');
  });

  it("positions the official badge from the current one-line title length", () => {
    const shortTitleBadgeX = readOfficialBadgeX(buildSvg({ official: true, title: "Matt" }));
    const normalTitleBadgeX = readOfficialBadgeX(
      buildSvg({ official: true, organizationLogos: [transparentPixel] }),
    );
    const longerTitleBadgeX = readOfficialBadgeX(
      buildSvg({
        official: true,
        title: "Matt Van Horn!",
        organizationLogos: [transparentPixel],
      }),
    );

    expect(shortTitleBadgeX).toBeLessThan(normalTitleBadgeX ?? 0);
    expect(longerTitleBadgeX).toBeGreaterThan(normalTitleBadgeX ?? 0);
  });

  it("adds extra badge spacing after truncated title dots", () => {
    const svg = buildSvg({
      official: true,
      title: "Matt Van Horn lalalallalalalalalallallalalalalalalalala",
      handleLabel: "@mvanhornfgfgfgfgfggfgfgfgfgfgsd",
      organizationLogos: [transparentPixel],
    });

    expect(readTitleLastLine(svg)).toMatch(/\.\.\.$/);
    expect(readOfficialBadgeX(svg)).toBe(1056.18);
  });

  it("keeps fixed labels anchored when variable publisher text changes", () => {
    const normalSvg = buildSvg({ official: true });
    const variableSvg = buildSvg({
      official: true,
      title: "Ana",
      handleLabel: "@ana-tools",
      stats: [{ label: "Downloads", value: "9.8m" }],
    });

    for (const stableMarkup of [
      '<text x="542" y="303"',
      ">on ClawHub</text>",
      '<text x="542" y="380"',
      ">Creator</text>",
      '<text x="913" y="380"',
      ">Downloads</text>",
    ]) {
      expect(normalSvg).toContain(stableMarkup);
      expect(variableSvg).toContain(stableMarkup);
    }
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

  it("renders fallback organization tiles when verified affiliations have no logos", () => {
    const svg = buildSvg({
      organizationCount: 2,
      organizationLogos: [],
    });
    expect(svg).toContain("Organizations");
    expect(svg).toContain("orgLogoClip0");
    expect(svg).toContain("orgLogoClip1");
    expect(svg).not.toContain("orgLogoClip2");
    expect(svg).toContain(
      `<image href="${clawHubLogoDataUrl}" x="169" y="459" width="48" height="48" clip-path="url(#orgLogoClip0)"`,
    );
  });

  it("caps rendered organization logos at five", () => {
    const svg = buildSvg({
      organizationCount: 6,
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
    expect(svg).toContain('font-size="44"');
    expect(svg).toContain('font-size="24"');
    expect(svg).toMatch(/@mvanhornfgfgfgfgfgg.*\.\.\./);
    expect(svg).toContain("...");
    expect(svg).not.toContain("…");
    expect(svg).toContain('x="110" y="500" width="48" height="48"');
    expect(svg).toContain('x="447" y="547"');
    expect(svg).toContain(">41.9k</text>");
  });

  it("accounts for full-width glyphs when fitting publisher text", () => {
    const svg = buildSvg({
      official: true,
      title: "这是一个非常长的发布者名称测试测试测试测试测试",
      handleLabel: "@测试测试测试测试测试测试测试测试测试测试",
    });

    expect(svg).toContain('<tspan x="447" dy="0">这是一个非常长的</tspan>');
    expect(svg).toContain('<tspan x="447" dy="84">发布者名称测试...</tspan>');
    expect(svg).toContain("@测试测试测试测试测试测试测...");
    expect(readOfficialBadgeX(svg)).toBe(1037.7);
    expect(svg).not.toContain("发布者名称测试测试测试测试测试</tspan>");
  });
});
