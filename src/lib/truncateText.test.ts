import { describe, expect, it } from "vitest";
import { PUBLIC_CATALOG_NAME_PREVIEW_LENGTH, truncateText } from "./truncateText";

// Catalog summaries taken verbatim from fixtures/public-corpus/corpus.jsonl.
const ZH_SUMMARY =
  "5GC Web仪表自动化技能，支持AMF/UDM/AUSF/SMF/PGW-C/UPF/PGW-U/GNB/UE/PCF/NRF/QoS/TC/PCC/smpolicy的批量添加与编辑及PCF默认规则一键配置";
const ZH_MIXED_SUMMARY =
  "实施Claude Code架构的5阶段进化计划，将OpenClaw系统升级到生产级Agent架构。包括记忆系统升级、工具系统优化、多Agent协作增强、安全架构强化和Prompt优化。当用户需要：1) 将现有OpenClaw系统升级到Claude Code架构标准，2) 实施结构化记忆系统，3) 建立四层权限模型，4) 配置多Agent协作，5) 增强安全架构，6) 优化Prompt和上下文管理时使用此技能。";
const JA_SUMMARY =
  "Claude Code向けのワークフロー自動化スキルパックです。日々のリリース作業やレビュー依頼をまとめて処理し、開発チームの負担を減らします。設定ファイルは不要で、導入したその日から使えます。";

describe("truncateText", () => {
  it("returns short values unchanged", () => {
    expect(truncateText("Deploy helper", 40)).toBe("Deploy helper");
    expect(truncateText("  Deploy helper  ", 40)).toBe("Deploy helper");
  });

  it("collapses internal whitespace before measuring", () => {
    expect(truncateText("Deploy\n\thelper   pack", 40)).toBe("Deploy helper pack");
  });

  it("cuts space-separated text at a word boundary", () => {
    expect(truncateText("A skill that automates deployment pipelines", 40)).toBe(
      "A skill that automates deployment…",
    );
    expect(truncateText("Generate release notes from your commit history", 30)).toBe(
      "Generate release notes from…",
    );
    expect(truncateText("automation toolkit for release engineering teams", 30)).toBe(
      "automation toolkit for…",
    );
  });

  it("keeps the word boundary when a long Latin word ends the slice", () => {
    // The only space sits before 60% of the slice, but the discarded tail is space-separated
    // text, so the preview must still end on a word rather than mid-word.
    expect(truncateText("Read this hyperextendedword", 20)).toBe("Read this…");
    expect(truncateText("Ship internationalization", 22)).toBe("Ship…");
  });

  it("keeps the Latin word boundary when only a short CJK tail is discarded", () => {
    // Here the boundary already keeps most of the slice, so backtracking loses nothing but a
    // stray CJK character that reads as noise on its own.
    expect(truncateText("Deploy helper for 中文文档管理", 20)).toBe("Deploy helper for…");
    expect(truncateText("Release notes generator 日本語対応", 28)).toBe("Release notes generator…");
  });

  it("keeps the preview budget for Chinese summaries carrying an early Latin space", () => {
    // The single space after "5GC" is the only space in 104 characters, so backtracking
    // to it would leave a three-character preview.
    expect(truncateText(ZH_SUMMARY, 80)).toBe(
      "5GC Web仪表自动化技能，支持AMF/UDM/AUSF/SMF/PGW-C/UPF/PGW-U/GNB/UE/PCF/NRF/QoS/TC/PCC/smp…",
    );
    expect(truncateText(ZH_SUMMARY, 100)).toBe(
      "5GC Web仪表自动化技能，支持AMF/UDM/AUSF/SMF/PGW-C/UPF/PGW-U/GNB/UE/PCF/NRF/QoS/TC/PCC/smpolicy的批量添加与编辑及PCF默认规…",
    );
  });

  it("keeps the preview budget when a Latin product name opens a Chinese summary", () => {
    expect(truncateText(ZH_MIXED_SUMMARY, 80)).toBe(
      "实施Claude Code架构的5阶段进化计划，将OpenClaw系统升级到生产级Agent架构。包括记忆系统升级、工具系统优化、多Agent协作增强、安全架…",
    );
  });

  it("keeps the preview budget for Japanese summaries carrying an early Latin space", () => {
    expect(truncateText(JA_SUMMARY, 80)).toBe(
      "Claude Code向けのワークフロー自動化スキルパックです。日々のリリース作業やレビュー依頼をまとめて処理し、開発チームの負担を減らします。設定ファイルは…",
    );
  });

  it("cuts hard when the text contains no space at all", () => {
    expect(truncateText("仪表自动化技能支持批量添加与编辑及默认规则一键配置", 10)).toBe(
      "仪表自动化技能支持…",
    );
  });

  it("never exceeds the requested budget", () => {
    for (const sample of [ZH_SUMMARY, ZH_MIXED_SUMMARY, JA_SUMMARY]) {
      for (const budget of [PUBLIC_CATALOG_NAME_PREVIEW_LENGTH, 80, 100]) {
        expect(truncateText(sample, budget).length).toBeLessThanOrEqual(budget);
      }
    }
  });
});
