import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntermediaryDisclosure } from "./IntermediaryDisclosure";

describe("intermediary disclosure", () => {
  it("distinguishes an explicit direct route from missing inspection", () => {
    const { rerender } = render(<IntermediaryDisclosure />);
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.queryByText(/AI-inferred/)).toBeNull();
    rerender(
      <IntermediaryDisclosure
        requiresIntermediary={false}
        intermediaryDetails="Connects directly to Gmail."
      />,
    );
    expect(screen.getByText("No")).toBeTruthy();
    expect(screen.getByText("Connects directly to Gmail.")).toBeTruthy();
    expect(screen.getByText(/AI-inferred/)).toBeTruthy();
  });

  it("shows required services as plain text, not executable markup", () => {
    render(
      <IntermediaryDisclosure
        requiresIntermediary
        intermediaryDetails="Requires Bridge account. <script>alert(1)</script>"
      />,
    );
    expect(screen.getByText("Yes")).toBeTruthy();
    expect(screen.getByText(/Requires Bridge account/)).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
  });
});
