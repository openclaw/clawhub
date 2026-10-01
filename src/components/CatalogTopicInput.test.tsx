/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CatalogTopicInput } from "./CatalogTopicInput";

function TopicInputHarness({ initialValue = "" }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return <CatalogTopicInput id="topics" value={value} onChange={setValue} />;
}

describe("CatalogTopicInput", () => {
  it("allows typing a multi-word topic before Enter commits its slug", () => {
    render(<TopicInputHarness />);

    const input = screen.getByLabelText("Topics");
    fireEvent.change(input, { target: { value: "GPU" } });
    fireEvent.keyDown(input, { key: " " });

    expect(screen.queryByText("#gpu")).toBeNull();
    fireEvent.change(input, { target: { value: "GPU development" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("#gpu-development")).toBeTruthy();
  });

  it("allows typing punctuation before Enter commits the normalized slug", () => {
    render(<TopicInputHarness />);

    const input = screen.getByLabelText("Topics");
    fireEvent.change(input, { target: { value: "CI" } });
    fireEvent.keyDown(input, { key: "," });

    expect(screen.queryByText("#ci")).toBeNull();
    fireEvent.change(input, { target: { value: "CI, CD" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("#ci-cd")).toBeTruthy();
  });

  it("normalizes topic chips to lowercase", () => {
    render(<TopicInputHarness initialValue='"CI, CD", GPU Development' />);

    expect(screen.getByText("#ci, cd")).toBeTruthy();
    expect(screen.getByText("#gpu development")).toBeTruthy();
  });

  it("auto-hyphenates a pasted multi-word topic with Enter", () => {
    render(<TopicInputHarness />);

    const input = screen.getByLabelText("Topics");
    fireEvent.change(input, { target: { value: "GPU Development" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("#gpu-development")).toBeTruthy();
  });

  it("removes topic chips with their remove button or Backspace", () => {
    render(<TopicInputHarness initialValue="email, calendar" />);

    fireEvent.click(screen.getByRole("button", { name: "Remove email topic" }));
    expect(screen.queryByText("#email")).toBeNull();

    const input = screen.getByLabelText("Topics");
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(screen.queryByText("#calendar")).toBeNull();
  });

  it("preserves existing multi-word and comma-containing topics", () => {
    render(<TopicInputHarness initialValue='"CI, CD", GPU development' />);

    expect(screen.getByText("#ci, cd")).toBeTruthy();
    expect(screen.getByText("#gpu development")).toBeTruthy();
  });

  it("uses keyword vocabulary consistently", () => {
    function KeywordHarness() {
      const [value, setValue] = useState("email, calendar, search, automation, productivity");
      return (
        <CatalogTopicInput id="keywords" value={value} vocabulary="keywords" onChange={setValue} />
      );
    }

    render(<KeywordHarness />);

    expect(screen.getByPlaceholderText("Maximum 5 keywords")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove email keyword" }));
    expect(screen.getByPlaceholderText("Add keywords")).toBeTruthy();
  });

  it("associates supporting count text with the keyword input", () => {
    render(
      <>
        <span id="keyword-count">0 of 5 keywords used</span>
        <CatalogTopicInput
          id="keywords"
          value=""
          describedBy="keyword-count"
          vocabulary="keywords"
          onChange={() => {}}
        />
      </>,
    );

    expect(screen.getByLabelText("Search keywords").getAttribute("aria-describedby")).toBe(
      "keyword-count",
    );
  });
});
