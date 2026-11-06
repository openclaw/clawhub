import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import {
  buildSkillInstallTarget,
  buildSkillPageUrl,
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

  it("formats the OpenClaw and skills CLI commands", () => {
    expect(formatOpenClawInstallCommand("@steipete/weather")).toBe(
      "openclaw skills install @steipete/weather",
    );
    expect(formatSkillsCliInstallCommand("https://clawhub.ai/steipete/skills/weather")).toBe(
      "npx skills add https://clawhub.ai/steipete/skills/weather",
    );
  });

  it("builds a one-line ClawHub install prompt", () => {
    expect(formatOpenClawPrompt("@steipete/weather")).toBe(
      "install @steipete/weather from ClawHub",
    );
    expect(formatOpenClawPrompt(" @openclaw/luma ")).toBe("install @openclaw/luma from ClawHub");
  });

  it("avoids fabricating unknown owner URLs when the owner is missing", () => {
    expect(buildSkillPageUrl(null, null, "weather")).toBeNull();
  });
});
