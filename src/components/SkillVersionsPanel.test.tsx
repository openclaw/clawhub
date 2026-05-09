/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { SkillVersionsPanel } from "./SkillVersionsPanel";

function makeVersion(overrides: Partial<Doc<"skillVersions">> = {}): Doc<"skillVersions"> {
  return {
    _id: "skillVersions:1" as Id<"skillVersions">,
    _creationTime: 1,
    skillId: "skills:1" as Id<"skills">,
    version: "1.0.0",
    createdAt: 1,
    changelog: "Initial release.",
    files: [],
    parsed: {},
    sha256hash: "b".repeat(64),
    ...overrides,
  } as unknown as Doc<"skillVersions">;
}

describe("SkillVersionsPanel", () => {
  it("shows TrentClaw verdict badges in the versions list", () => {
    render(
      <SkillVersionsPanel
        versions={[
          makeVersion({
            trentAnalysis: {
              skillSha256: "b".repeat(64),
              verdict: "vulnerable",
              checkedAt: 1,
            },
          }),
        ]}
        nixPlugin={false}
        skillSlug="todo-guard"
        suppressScanResults={false}
        suppressedMessage={null}
      />,
    );

    expect(screen.getByLabelText("TrentClaw")).toBeTruthy();
    expect(screen.getByText("Vulnerable")).toBeTruthy();
    const trentLink = screen
      .getAllByRole("link", { name: "↗" })
      .find((link) => link.getAttribute("href")?.includes("api.trent.ai"));
    expect(trentLink?.getAttribute("href")).toBe(
      `https://api.trent.ai/v1/humber-agent/openclaw/skills/verdict/${"b".repeat(64)}`,
    );
  });
});
