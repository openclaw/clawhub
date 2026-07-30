import { describe, expect, it } from "vitest";
import { computeQualitySignals, evaluateQuality } from "./skillQuality";

// Frontmatter is optional when publishing a skill: `publishSkillVersion` takes
// the display name from its arguments and `parseFrontmatter` simply returns an
// empty record when the document has none. A SKILL.md may therefore open with a
// heading and use `---` purely as a Markdown thematic break.
const BODY_LINES = [
  "## How it works",
  "",
  "The skill resolves a location from the incoming request and queries the",
  "national weather service for the current forecast window. Responses are",
  "normalized into a single unit system before rendering, so a caller never",
  "has to reconcile mixed metric and imperial values inside one table.",
  "",
  "- Resolves the location from the request payload",
  "- Calls the upstream forecast endpoint with a bounded timeout",
  "- Normalizes temperature, wind speed and precipitation units",
  "- Renders the result as a compact table for the agent to read",
  "",
  "## Configuration",
  "",
  "Set the upstream endpoint and the request timeout through environment",
  "variables. Both carry defaults that work for local development.",
];

const THEMATIC_BREAK_README = [
  "# Weather Report Skill",
  "",
  "---",
  "",
  ...BODY_LINES,
  "",
  "---",
  "",
  "Rate limits apply.",
].join("\n");

const LEADING_THEMATIC_BREAK_README = [
  "---",
  "",
  "# Weather Report Skill",
  "",
  ...BODY_LINES,
  "",
  "---",
  "",
  "Rate limits apply.",
].join("\n");

const FRONTMATTER_README = [
  "---",
  "name: weather-report",
  "description: Fetches forecasts from the national weather service.",
  "---",
  "",
  "# Weather Report Skill",
  "",
  ...BODY_LINES,
].join("\n");

const NO_FRONTMATTER_README = ["# Weather Report Skill", "", ...BODY_LINES].join("\n");

const SUMMARY = "Fetches forecasts and renders them as a normalized table.";

describe("computeQualitySignals", () => {
  it("keeps the body of a frontmatter-less SKILL.md that uses thematic breaks", () => {
    const signals = computeQualitySignals({
      readmeText: THEMATIC_BREAK_README,
      summary: SUMMARY,
    });

    expect(signals.headingCount).toBe(3);
    expect(signals.bulletCount).toBe(4);
    expect(signals.bodyWords).toBeGreaterThanOrEqual(80);
  });

  it("still strips real frontmatter", () => {
    const withFrontmatter = computeQualitySignals({
      readmeText: FRONTMATTER_README,
      summary: SUMMARY,
    });
    const withoutFrontmatter = computeQualitySignals({
      readmeText: NO_FRONTMATTER_README,
      summary: SUMMARY,
    });

    expect(withFrontmatter.bodyWords).toBe(withoutFrontmatter.bodyWords);
    expect(withFrontmatter.bodyChars).toBe(withoutFrontmatter.bodyChars);
  });

  it("strips real frontmatter with CR line endings", () => {
    const withFrontmatter = computeQualitySignals({
      readmeText: FRONTMATTER_README.replaceAll("\n", "\r"),
      summary: SUMMARY,
    });
    const withoutFrontmatter = computeQualitySignals({
      readmeText: NO_FRONTMATTER_README,
      summary: SUMMARY,
    });

    expect(withFrontmatter).toMatchObject({
      bodyWords: withoutFrontmatter.bodyWords,
      bodyChars: withoutFrontmatter.bodyChars,
      headingCount: withoutFrontmatter.headingCount,
      bulletCount: withoutFrontmatter.bulletCount,
    });
  });
});

describe("evaluateQuality", () => {
  it("does not reject a documented frontmatter-less skill from a new account", () => {
    const signals = computeQualitySignals({
      readmeText: THEMATIC_BREAK_README,
      summary: SUMMARY,
    });

    const assessment = evaluateQuality({
      signals,
      trustTier: "low",
      similarRecentCount: 0,
    });

    expect(assessment.decision).toBe("pass");
  });

  it("does not reject a frontmatter-less skill that begins with a thematic break", () => {
    const signals = computeQualitySignals({
      readmeText: LEADING_THEMATIC_BREAK_README,
      summary: SUMMARY,
    });

    const assessment = evaluateQuality({
      signals,
      trustTier: "low",
      similarRecentCount: 0,
    });

    expect(assessment.decision).toBe("pass");
  });
});
