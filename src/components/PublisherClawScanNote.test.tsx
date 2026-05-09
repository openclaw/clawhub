import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PublisherClawScanNote } from "./PublisherClawScanNote";
import { TooltipProvider } from "./ui/tooltip";

function renderNote(note: string) {
  return render(
    <TooltipProvider>
      <PublisherClawScanNote note={note} />
    </TooltipProvider>,
  );
}

describe("PublisherClawScanNote", () => {
  it("clamps long publisher notes behind an explicit toggle", () => {
    const note = Array.from(
      { length: 8 },
      (_, index) => `Publisher context paragraph ${index + 1} explaining the scan input.`,
    ).join("\n");

    renderNote(note);

    const noteText = screen.getByText(/Publisher context paragraph 1/);
    expect(noteText.classList.contains("is-clamped")).toBe(true);

    const toggle = screen.getByRole("button", { name: "Show more" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    expect(noteText.classList.contains("is-clamped")).toBe(false);
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("renders the note help affordance", () => {
    renderNote("Publisher context.");

    expect(screen.getByRole("button", { name: "About publisher ClawScan notes" })).toBeTruthy();
  });
});
