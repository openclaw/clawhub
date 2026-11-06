import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginApiRetirementNotice } from "./PluginApiRetirementNotice";

const retirement = {
  deprecatedApi: "readAcpSessionEntry",
  replacement: "readAcpSessionEntryAsync",
  removeAfter: "2026-12-31",
};

describe("PluginApiRetirementNotice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("uses the approved calm copy with API details and no alert or icon", () => {
    const { container } = render(
      <PluginApiRetirementNotice retirements={[retirement, retirement]} />,
    );
    expect(screen.getByRole("region", { name: "OpenClaw API updates" }).textContent).toContain(
      "Uses OpenClaw APIs that retire on Dec 31, 2026. It keeps working until then; the author can update to readAcpSessionEntryAsync.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelectorAll("dt")).toHaveLength(1);
    expect(container.querySelector("dd")?.textContent).toBe(retirement.replacement);
  });

  it("preserves the final compatibility day and avoids reassurance after it", () => {
    vi.setSystemTime(new Date("2026-12-31T23:59:59Z"));
    const view = render(<PluginApiRetirementNotice retirements={[retirement]} />);
    expect(screen.getByText(/It keeps working until then/)).toBeTruthy();
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    view.rerender(<PluginApiRetirementNotice retirements={[retirement]} />);
    expect(screen.queryByText(/It keeps working until then/)).toBeNull();
    expect(screen.getByText(/retirement date of Dec 31, 2026/)).toBeTruthy();
  });

  it("keeps long migration guidance in details and honors different dates", () => {
    render(
      <PluginApiRetirementNotice
        retirements={[
          { ...retirement, replacement: "Await the replacement before releasing the turn lease." },
          { ...retirement, deprecatedApi: "earlierApi", removeAfter: "2026-11-30" },
        ]}
      />,
    );
    expect(screen.getByText(/retire on Nov 30, 2026/)).toBeTruthy();
    expect(screen.getByText(/author can update to the replacement APIs below/)).toBeTruthy();
    expect(screen.getByText("Await the replacement before releasing the turn lease.")).toBeTruthy();
  });

  it("renders nothing without usable retirements", () => {
    const { container } = render(<PluginApiRetirementNotice retirements={[]} />);
    expect(container.textContent).toBe("");
  });
});
