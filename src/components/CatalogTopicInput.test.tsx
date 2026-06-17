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
  it("commits a topic chip when space is pressed", () => {
    render(<TopicInputHarness />);

    const input = screen.getByLabelText("Topics");
    fireEvent.change(input, { target: { value: "email" } });
    fireEvent.keyDown(input, { key: " " });

    expect(screen.getByText("#email")).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("commits topics with Enter and comma", () => {
    render(<TopicInputHarness />);

    const input = screen.getByLabelText("Topics");
    fireEvent.change(input, { target: { value: "calendar" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "productivity" } });
    fireEvent.keyDown(input, { key: "," });

    expect(screen.getByText("#calendar")).toBeTruthy();
    expect(screen.getByText("#productivity")).toBeTruthy();
  });

  it("normalizes topic chips to lowercase", () => {
    render(<TopicInputHarness initialValue='"CI, CD", GPU Development' />);

    expect(screen.getByText("#ci, cd")).toBeTruthy();
    expect(screen.getByText("#gpu development")).toBeTruthy();
  });

  it("commits a pasted multi-word topic with Enter", () => {
    render(<TopicInputHarness />);

    const input = screen.getByLabelText("Topics");
    fireEvent.change(input, { target: { value: "GPU Development" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("#gpu development")).toBeTruthy();
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
});
