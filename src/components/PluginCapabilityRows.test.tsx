/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { PLUGIN_UI_CAPABILITIES } from "clawhub-schema";
import { BookOpenText } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import {
  PLUGIN_EXTENSION_LABELS,
  PluginCapabilityRow,
  PluginCapabilitySection,
  PluginExtensionIcon,
} from "./PluginCapabilityRows";

describe("plugin capability rows", () => {
  it("uses ruled section headings with a visual count without changing the accessible title", () => {
    const { container } = render(
      <PluginCapabilitySection id="extensions" title="Extensions" count={9}>
        <div role="list" />
      </PluginCapabilitySection>,
    );
    expect(screen.getByRole("region", { name: "Extensions" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Extensions" })).toBeTruthy();
    expect(container.querySelector(".plugin-capability-count")?.textContent).toBe("9");
  });

  it("keeps the whole preview row keyboard-operable with the existing preview label", () => {
    const onOpen = vi.fn();
    render(
      <div role="list">
        <PluginCapabilityRow
          name="workspace-research"
          description="Research a workspace with sources."
          icon={<BookOpenText />}
          onOpen={onOpen}
          openLabel="Preview workspace-research"
        />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview workspace-research" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByText("Research a workspace with sources.")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("renders distinct canonical artwork and copy for every declared extension kind", () => {
    const { container } = render(
      <>
        {PLUGIN_UI_CAPABILITIES.map((kind) => (
          <div key={kind}>
            <PluginExtensionIcon kind={kind} />
            <span>{PLUGIN_EXTENSION_LABELS[kind][0]}</span>
          </div>
        ))}
      </>,
    );
    const icons = Array.from(container.querySelectorAll("svg"));
    expect(icons).toHaveLength(9);
    expect(new Set(icons.map((icon) => icon.innerHTML)).size).toBe(9);
    expect(icons.every((icon) => icon.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(screen.getByText("Session accessories")).toBeTruthy();
    expect(screen.getByText("Link previews")).toBeTruthy();
  });
});
