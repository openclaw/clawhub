/* @vitest-environment node */
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDiscordPayload,
  buildSkillUrl,
  getWebhookConfig,
  shouldSendWebhook,
} from "./webhooks";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("webhook config", () => {
  it("parses highlighted-only flag", () => {
    process.env.DISCORD_WEBHOOK_URL = "https://example.com";
    process.env.DISCORD_WEBHOOK_HIGHLIGHTED_ONLY = "true";
    const config = getWebhookConfig();
    expect(config.highlightedOnly).toBe(true);
  });

  it("defaults site url when missing", () => {
    delete process.env.SITE_URL;
    process.env.DISCORD_WEBHOOK_URL = "https://example.com";
    const config = getWebhookConfig();
    expect(config.siteUrl).toBe("https://clawhub.ai");
  });
});

describe("webhook filtering", () => {
  it("skips when url missing", () => {
    const config = getWebhookConfig({} as NodeJS.ProcessEnv);
    expect(shouldSendWebhook("skill.publish", { slug: "demo", displayName: "Demo" }, config)).toBe(
      false,
    );
  });

  it("filters non-highlighted when highlighted-only", () => {
    const config = {
      url: "https://example.com",
      highlightedOnly: true,
      siteUrl: "https://clawhub.ai",
    };
    const allowed = shouldSendWebhook(
      "skill.publish",
      { slug: "demo", displayName: "Demo", highlighted: false },
      config,
    );
    expect(allowed).toBe(false);
  });

  it("allows highlighted event when highlighted-only", () => {
    const config = {
      url: "https://example.com",
      highlightedOnly: true,
      siteUrl: "https://clawhub.ai",
    };
    const allowed = shouldSendWebhook(
      "skill.highlighted",
      { slug: "demo", displayName: "Demo", highlighted: true },
      config,
    );
    expect(allowed).toBe(true);
  });
});

describe("payload building", () => {
  it("builds canonical url with owner", () => {
    const url = buildSkillUrl(
      { slug: "beeper", displayName: "Beeper", ownerHandle: "KrauseFx" },
      "https://clawhub.ai",
    );
    expect(url).toBe("https://clawhub.ai/KrauseFx/skills/beeper");
  });

  it("builds a publish embed", () => {
    const payload = buildDiscordPayload(
      "skill.publish",
      {
        slug: "demo",
        displayName: "Demo Skill",
        summary: "Nice skill",
        version: "1.2.3",
        ownerHandle: "steipete",
        tags: ["latest", "discord"],
      },
      { url: "https://example.com", highlightedOnly: false, siteUrl: "https://clawhub.ai" },
    );
    const embed = payload.embeds[0];
    expect(embed.title).toBe("Demo Skill");
    expect(embed.description).toBe("Nice skill");
    expect(embed.fields[0].value).toBe("v1.2.3");
  });

  it("keeps titles within Discord's 256-character embed limit", () => {
    const displayName =
      "Query trade area distribution analysis for HS codes — retrieve trade distribution data by country/region for a specified HS code, with exporter/importer type and recent months filters. Provides trade counts, amounts, buyer counts and seller counts per country for comprehensive geographic market analysis across global customs data covering 220+ countries and territories. Designed for trade analysts, market researchers and import-export professionals who need to understand which countries trade a specific product, analyze regional distribution patterns and compare exporter vs importer country activity for strategic market planning.";

    const payload = buildDiscordPayload(
      "skill.publish",
      {
        slug: "customs-analysis-area",
        displayName,
        summary: "Query trade area distribution analysis.",
        version: "1.0.0",
        ownerHandle: "upkuajing",
      },
      { url: "https://example.com", highlightedOnly: false, siteUrl: "https://clawhub.ai" },
    );

    expect(payload.embeds[0].title).toHaveLength(256);
    expect(payload.embeds[0].title.endsWith("…")).toBe(true);
  });

  it("does not split an emoji at the Discord title boundary", () => {
    const payload = buildDiscordPayload(
      "skill.publish",
      {
        slug: "emoji-boundary",
        displayName: `${"a".repeat(254)}😀tail`,
      },
      { url: "https://example.com", highlightedOnly: false, siteUrl: "https://clawhub.ai" },
    );

    expect(payload.embeds[0].title).toBe(`${"a".repeat(254)}…`);
    expect(payload.embeds[0].title).not.toContain("�");
  });

  it("does not split a compound emoji at the Discord title boundary", () => {
    const payload = buildDiscordPayload(
      "skill.publish",
      {
        slug: "flag-boundary",
        displayName: `${"a".repeat(252)}🇺🇸tail`,
      },
      { url: "https://example.com", highlightedOnly: false, siteUrl: "https://clawhub.ai" },
    );

    expect(payload.embeds[0].title).toBe(`${"a".repeat(252)}…`);
  });
});
