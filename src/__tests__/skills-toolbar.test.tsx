/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { SkillsToolbar } from "../routes/skills/-SkillsToolbar";

function renderToolbar(overrides?: Partial<ComponentProps<typeof SkillsToolbar>>) {
  return render(
    <SkillsToolbar
      searchInputRef={createRef<HTMLInputElement>()}
      query=""
      hasQuery={false}
      sort="downloads"
      dir="desc"
      view="list"
      highlightedOnly={false}
      nonSuspiciousOnly={false}
      capabilityTag={undefined}
      onQueryChange={vi.fn()}
      onToggleHighlighted={vi.fn()}
      onToggleNonSuspicious={vi.fn()}
      onCapabilityTagChange={vi.fn()}
      onSortChange={vi.fn()}
      onToggleDir={vi.fn()}
      onToggleView={vi.fn()}
      {...overrides}
    />,
  );
}

describe("SkillsToolbar", () => {
  it("keeps filter chips on a dark-mode surface", () => {
    renderToolbar();

    const staffPicksButton = screen.getByRole("button", { name: "Staff Picks" });

    expect(staffPicksButton.className).toContain("dark:bg-[rgba(14,28,37,0.84)]");
    expect(staffPicksButton.className).toContain("dark:text-[rgba(245,238,232,0.88)]");
  });

  it("uses a readable active color treatment in dark mode", () => {
    renderToolbar({ highlightedOnly: true });

    const staffPicksButton = screen.getByRole("button", { name: "Staff Picks" });

    expect(staffPicksButton.getAttribute("aria-pressed")).toBe("true");
    expect(staffPicksButton.className).toContain("dark:bg-[rgba(255,131,95,0.14)]");
    expect(staffPicksButton.className).toContain("dark:text-[#ffd5c9]");
  });
});
