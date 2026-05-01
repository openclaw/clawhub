import type { ClawdisSkillMetadata } from "clawhub-schema";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import {
  buildSkillInstallTarget,
  buildSkillPageUrl,
  formatClawHubInstallCommand,
  formatOpenClawInstallCommand,
  formatOpenClawPrompt,
} from "./skillDetailUtils";

describe("skill detail install helpers", () => {
  const ownerPublisherId = "publishers:1" as Id<"publishers">;

  it("prefers the owner handle for install targets", () => {
    expect(buildSkillInstallTarget("steipete", ownerPublisherId, "weather")).toBe(
      "steipete/weather",
    );
  });

  it("falls back to owner id and then plain slug", () => {
    expect(buildSkillInstallTarget(null, ownerPublisherId, "weather")).toBe("publishers:1/weather");
    expect(buildSkillInstallTarget(null, null, "weather")).toBe("weather");
  });

  it("formats the OpenClaw and ClawHub commands", () => {
    expect(formatOpenClawInstallCommand("weather")).toBe("openclaw skills install weather");
    expect(formatClawHubInstallCommand("weather", "npm")).toBe(
      "npx clawhub@latest install weather",
    );
    expect(formatClawHubInstallCommand("weather", "pnpm")).toBe(
      "pnpm dlx clawhub@latest install weather",
    );
    expect(formatClawHubInstallCommand("weather", "bun")).toBe(
      "bunx clawhub@latest install weather",
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

    expect(prompt).toContain("steipete/weather");
    expect(prompt).toContain("http://localhost/steipete/weather");
    expect(prompt).toContain("WEATHER_API_KEY");
    expect(prompt).toContain("curl");
    expect(prompt).toContain("~/.weatherrc");
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

    expect(prompt).toContain('Install the skill "Weather" (weather) from ClawHub.');
    expect(prompt).not.toContain("Skill page:");
    expect(prompt).not.toContain("unknown");
  });
});
