/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrowseResultsSkeleton } from "./BrowseResultsSkeleton";

describe("BrowseResultsSkeleton", () => {
  it.each(["list", "grid"] as const)(
    "preserves icon placeholders by default for %s consumers",
    (variant) => {
      render(<BrowseResultsSkeleton count={2} label="Plugin" variant={variant} />);

      const loadingResults = screen.getByRole("status", { name: "Loading results" });
      if (variant === "list") {
        expect(loadingResults.querySelector(".browse-list-head-icon-spacer")).not.toBeNull();
        expect(loadingResults.querySelectorAll(".browse-results-skeleton-icon")).toHaveLength(2);
        expect(loadingResults.querySelector(".skill-list-item-no-icon")).toBeNull();
      } else {
        expect(loadingResults.querySelectorAll(".skill-card-header")).toHaveLength(2);
        expect(loadingResults.querySelectorAll(".browse-results-skeleton-icon")).toHaveLength(2);
        expect(loadingResults.querySelector(".skill-card-header-no-icon")).toBeNull();
        for (const header of loadingResults.querySelectorAll(".skill-card-header")) {
          expect(header.children).toHaveLength(2);
          expect(header.children[1]?.classList.contains("skill-card-identity")).toBe(true);
        }
      }
    },
  );
});
