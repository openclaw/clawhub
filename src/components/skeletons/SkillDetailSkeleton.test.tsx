/* @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SkillDetailSkeleton } from "./SkillDetailSkeleton";

afterEach(cleanup);

describe("SkillDetailSkeleton", () => {
  it.each(["skill", "plugin"] as const)(
    "places the %s install card in the rail and once in the narrow-screen content",
    (kind) => {
      const { container } = render(<SkillDetailSkeleton kind={kind} />);
      const cards = container.querySelectorAll(".skill-install-command-card");
      expect(cards).toHaveLength(2);
      expect(
        container.querySelector(".skill-hero-sidebar-stack > .skill-install-command-card"),
      ).not.toBeNull();
      expect(
        container.querySelector(
          ".skill-hero-main-extra .detail-skeleton-install-mobile .skill-install-command-card",
        ),
      ).not.toBeNull();
      // The loaded card opens on one action row, not a command box in the content column.
      expect(container.querySelector(".skill-install-command-shell")).toBeNull();
    },
  );

  it("keeps the plugin card inside the About panel, after the section tabs", () => {
    const { container } = render(<SkillDetailSkeleton kind="plugin" />);
    expect(
      container.querySelector(".detail-mobile-master-panel > .detail-skeleton-install-mobile"),
    ).not.toBeNull();
  });
});
