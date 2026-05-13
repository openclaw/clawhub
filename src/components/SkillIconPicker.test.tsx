import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SkillIconPicker } from "./SkillIconPicker";

describe("SkillIconPicker", () => {
  it("renders a 'None' option plus every allow-listed icon", () => {
    render(<SkillIconPicker value={null} onChange={() => {}} />);
    // The "None" option uses a textual label rather than an icon.
    expect(screen.getByRole("radio", { name: "No icon" })).toBeTruthy();
    // Each allow-listed icon shows up as a radio button labelled by its name.
    expect(screen.getByRole("radio", { name: "Plug" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Code2" })).toBeTruthy();
  });

  it("marks the current selection as aria-checked", () => {
    render(<SkillIconPicker value="Plug" onChange={() => {}} />);
    const plug = screen.getByRole("radio", { name: "Plug" });
    expect(plug.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "No icon" }).getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("falls back to 'No icon' selected when value is null", () => {
    render(<SkillIconPicker value={null} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "No icon" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("calls onChange with the icon name when a tile is clicked", () => {
    const onChange = vi.fn();
    render(<SkillIconPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Plug" }));
    expect(onChange).toHaveBeenCalledWith("Plug");
  });

  it("calls onChange(null) when the 'No icon' tile is clicked", () => {
    const onChange = vi.fn();
    render(<SkillIconPicker value="Plug" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "No icon" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows a contextual hint that mirrors the current selection", () => {
    const { rerender } = render(<SkillIconPicker value={null} onChange={() => {}} />);
    expect(screen.getByText(/Pick an icon shown on the skill card/i)).toBeTruthy();

    rerender(<SkillIconPicker value="Plug" onChange={() => {}} />);
    expect(screen.getByText(/Selected: Plug/)).toBeTruthy();
  });
});
