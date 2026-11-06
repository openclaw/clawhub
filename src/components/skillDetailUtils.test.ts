import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { parseClawdisMetadata, parseFrontmatter } from "../../convex/lib/skills";
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
    expect(formatOpenClawPrompt("@steipete/weather", "skill")).toBe(
      "Install the @steipete/weather skill from ClawHub",
    );
    expect(formatOpenClawPrompt(" @openclaw/luma ", "package")).toBe(
      "Install the @openclaw/luma package from ClawHub",
    );
  });

  it("keeps scalar credentials in setup instructions without requiring optional variables", () => {
    const setup = (markdown: string) =>
      formatOpenClawPrompt({
        mode: "install-and-setup",
        skillName: "Weather",
        slug: "weather",
        ownerHandle: "steipete",
        ownerId: ownerPublisherId,
        clawdis: parseClawdisMetadata(parseFrontmatter(markdown)),
      });
    expect(setup("---\nenv: WEATHER_API_KEY\n---\n")).toContain("WEATHER_API_KEY");
    expect(setup("---\nenv:\n  - name: OPTIONAL_KEY\n    required: false\n---\n")).not.toContain(
      "OPTIONAL_KEY",
    );
  });

  it("avoids fabricating unknown owner URLs when the owner is missing", () => {
    expect(buildSkillPageUrl(null, null, "weather")).toBeNull();
  });
});
