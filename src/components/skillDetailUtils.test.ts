import type { ClawdisSkillMetadata } from "clawhub-schema";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import {
  buildSkillInstallTarget,
  buildSkillPageUrl,
  formatClawHubInstallCommand,
  formatOpenClawInstallCommand,
  formatOpenClawPrompt,
  formatSkillsCliInstallCommand,
} from "./skillDetailUtils";

describe("skill detail install helpers", () => {
  const ownerPublisherId = "publishers:1" as Id<"publishers">;

  it("prefers the owner handle for install targets", () => {
    expect(buildSkillInstallTarget("steipete", ownerPublisherId, "weather")).toBe(
      "@steipete/weather",
    );
  });

  it("falls back to the plain slug when there is no owner handle", () => {
    expect(buildSkillInstallTarget(null, ownerPublisherId, "weather")).toBe("weather");
    expect(buildSkillInstallTarget(null, null, "weather")).toBe("weather");
  });

  it("formats the OpenClaw and ClawHub commands", () => {
    expect(formatOpenClawInstallCommand("@steipete/weather")).toBe(
      "openclaw skills install @steipete/weather",
    );
    expect(formatClawHubInstallCommand("@steipete/weather", "npm")).toBe(
      "npx clawhub@latest install @steipete/weather",
    );
    expect(formatClawHubInstallCommand("@steipete/weather", "pnpm")).toBe(
      "pnpm dlx clawhub@latest install @steipete/weather",
    );
    expect(formatClawHubInstallCommand("@steipete/weather", "bun")).toBe(
      "bunx clawhub@latest install @steipete/weather",
    );
    expect(formatSkillsCliInstallCommand("https://clawhub.ai/steipete/skills/weather")).toBe(
      "npx skills add https://clawhub.ai/steipete/skills/weather",
    );
  });

  it("builds the install-and-setup prompt from known metadata only", () => {
    const clawdis = {
      requires: {
        env: ["WEATHER_API_KEY"],
        bins: ["curl"],
        config: ["~/.weatherrc"],
      },
    } satisfies Partial<ClawdisSkillMetadata>;

    const prompt = formatOpenClawPrompt({
      mode: "install-and-setup",
      skillName: "Weather",
      slug: "weather",
      ownerHandle: "steipete",
      ownerId: ownerPublisherId,
      clawdis: clawdis as ClawdisSkillMetadata,
    });

    expect(prompt).toContain("@steipete/weather");
    expect(prompt).toContain("https://clawhub.ai/steipete/skills/weather");
    expect(prompt).toContain("WEATHER_API_KEY");
    expect(prompt).toContain("curl");
    expect(prompt).toContain("~/.weatherrc");
    expect(prompt.startsWith("Before installing anything")).toBe(true);
    expect(prompt).toContain("verify its source, maintainer, and package contents");
    expect(prompt).toContain(
      'Install the skill "Weather" (@steipete/weather) from ClawHub only after those checks pass.',
    );
    expect(prompt).toContain("After install, help me finish setup from verified skill metadata.");
    expect(prompt).not.toContain("unknown");
  });

  it("avoids fabricating unknown owner URLs when the owner is missing", () => {
    expect(buildSkillPageUrl(null, null, "weather")).toBeNull();

    const prompt = formatOpenClawPrompt({
      mode: "install-only",
      skillName: "Weather",
      slug: "weather",
      ownerHandle: null,
      ownerId: null,
    });

    expect(prompt.startsWith("Before installing anything")).toBe(true);
    expect(prompt).toContain(
      'Install the skill "Weather" (weather) from ClawHub only after those checks pass.',
    );
    expect(prompt).toContain("verify its source, maintainer, and package contents");
    expect(prompt).not.toContain("Skill page:");
    expect(prompt).not.toContain("unknown");
  });
});
