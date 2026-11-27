/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrowseResultsSkeleton } from "./BrowseResultsSkeleton";

describe("BrowseResultsSkeleton", () => {
  it("preserves icon placeholders by default", () => {
    render(<BrowseResultsSkeleton count={2} />);

    const loadingResults = screen.getByRole("status", { name: "Loading results" });
    expect(loadingResults.children).toHaveLength(1);
    expect(loadingResults.firstElementChild?.classList.contains("results-list")).toBe(true);
    expect(loadingResults.querySelectorAll(".browse-results-skeleton-row")).toHaveLength(2);
    expect(loadingResults.querySelectorAll(".browse-results-skeleton-icon")).toHaveLength(2);
    expect(loadingResults.querySelector(".skill-list-item-no-icon")).toBeNull();
  });
});
