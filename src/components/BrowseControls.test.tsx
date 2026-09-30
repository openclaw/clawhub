/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PLUGIN_CATEGORIES } from "../lib/categories";
import { BrowseCategorySelect, BrowseCategorySidebar, BrowseTopicChips } from "./BrowseControls";

describe("BrowseControls", () => {
  it("uses a microphone for Voice without changing the category selection", () => {
    const onChange = vi.fn();
    render(
      <BrowseCategorySidebar
        ariaLabel="Plugin categories"
        categories={PLUGIN_CATEGORIES}
        value="voice"
        onChange={onChange}
      />,
    );

    const voice = screen.getByRole("button", { name: "Voice" });
    expect(voice.querySelector("svg.lucide-mic")).toBeTruthy();
    expect(voice.querySelector("svg.lucide-message-square")).toBeNull();
    fireEvent.click(voice);
    expect(onChange).toHaveBeenCalledWith("voice");
  });

  it("renders chip-shaped placeholders while topics load", () => {
    const { container } = render(<BrowseTopicChips topics={[]} loading onChange={() => {}} />);

    expect(screen.getByRole("status", { name: "Loading topics" })).toBeTruthy();
    expect(container.querySelectorAll(".browse-topic-chip-skeleton")).toHaveLength(8);
  });

  it("keeps the category dropdown responsive and exposes desktop category buttons", () => {
    const onChange = vi.fn();
    const { container } = render(
      <>
        <BrowseCategorySelect
          categories={PLUGIN_CATEGORIES}
          value="channels"
          onChange={onChange}
          responsive
        />
        <BrowseCategorySidebar
          ariaLabel="Plugin categories"
          categories={PLUGIN_CATEGORIES}
          value="channels"
          onChange={onChange}
        />
      </>,
    );

    expect(container.querySelector(".browse-category-select-responsive")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(onChange).toHaveBeenCalledWith("models");
  });
});
