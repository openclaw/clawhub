import { describe, expect, it } from "vitest";
import { wrapText } from "./registryOgSvg";
import { buildSkillOgSvg } from "./skillOgSvg";

describe("skill OG SVG", () => {
  it("includes title, description, and labels", () => {
    const svg = buildSkillOgSvg({
      markDataUrl: "data:image/png;base64,AAA=",
      title: "Discord Doctor",
      description: "Quick diagnosis and repair for Discord bot.",
      ownerLabel: "@jhillock",
      versionLabel: "v1.2.3",
      installCommand: {
        subject: "skills",
        action: "install",
        target: "discord-doctor",
      },
      stats: [
        { value: "1.2k", label: "Downloads" },
        { value: "PASS", label: "Audit" },
      ],
    });

    expect(svg).toContain("Discord Doctor");
    expect(svg).toContain("Quick diagnosis and repair");
    expect(svg).toContain("@jhillock");
    expect(svg).toContain("PASS");
    expect(svg).toContain("Audit");
    expect(svg).toContain("openclaw");
    expect(svg).toContain("skills");
    expect(svg).toContain("install");
    expect(svg).toContain("discord-doctor");
  });

  it("wraps long titles to avoid clipping", () => {
    const svg = buildSkillOgSvg({
      markDataUrl: "data:image/png;base64,AAA=",
      title: "Excalidraw Flowchart Generator",
      description: "Create Excalidraw flowcharts from descriptions.",
      ownerLabel: "@swiftlysisngh",
      versionLabel: "v1.0.2",
    });

    const titleBlock = svg.match(/<text x="72" y="(?:174|184)"[\s\S]*?<\/text>/)?.[0] ?? "";
    const titleTspans = titleBlock.match(/<tspan /g) ?? [];
    expect(titleTspans.length).toBe(2);
    expect(svg).toContain("Excalidraw");
    expect(svg).toContain("Flowchart");
  });

  it("clips and wraps long descriptions", () => {
    const longWord = "a".repeat(200);
    const svg = buildSkillOgSvg({
      markDataUrl: "data:image/png;base64,AAA=",
      title: "Gurkerlcli",
      description: `Prefix ${longWord} suffix`,
      ownerLabel: "@pasogott",
      versionLabel: "v0.1.0",
    });

    expect(svg).toContain('<svg width="1200" height="630"');
    expect(svg).toContain('fill="url(#bgBase)"');
    expect(svg).not.toContain(longWord);
    expect(svg).toContain("…");

    const descBlock = svg.match(/<text[^>]*font-size="28"[\s\S]*?<\/text>/)?.[0] ?? "";
    const descTspans = descBlock.match(/<tspan /g) ?? [];
    expect(descTspans.length).toBeLessThanOrEqual(2);
  });

  it("wraps CJK text as full-width glyphs without inserting continuation ellipses", () => {
    const description = "西瓜视频数据查询助手。覆盖视频详情、用户数据、搜索、评论等全功能。";
    const lines = wrapText(description, 760, 28, 2);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines).toHaveLength(2);
    expect(lines.join("")).toBe(description);
    expect(lines[0]).not.toContain("…");
  });

  it("clips overlong CJK text on the last visible line", () => {
    const lines = wrapText("视频详情用户数据搜索评论".repeat(10), 760, 28, 2);

    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toContain("…");
    expect(lines[1]).toContain("…");
  });
});
