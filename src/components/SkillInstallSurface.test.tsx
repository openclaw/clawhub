/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillCommandLineCard, SkillInstallSurface } from "./SkillInstallSurface";

const writeTextMock = vi.fn();

vi.mock("./ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
}));

describe("SkillInstallSurface", () => {
  const ownerPublisherId = "publishers:1" as never;

  beforeEach(() => {
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });
  });

  it("renders the default install-and-setup preview and copies the selected prompt", async () => {
    render(
      <SkillInstallSurface
        slug="weather"
        displayName="Weather"
        ownerHandle="steipete"
        ownerId={ownerPublisherId}
        clawdis={
          {
            requires: {
              env: ["WEATHER_API_KEY"],
              bins: ["curl"],
            },
          } as never
        }
      />,
    );

    expect(screen.getByRole("heading", { name: "Install with OpenClaw" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "CLI Commands" })).toBeNull();
    expect(screen.getByText(/After install, inspect the skill metadata/i)).toBeTruthy();
    expect(screen.getAllByText("Install & Setup").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Install Only/i }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(
        expect.stringContaining("Stop after the skill is installed."),
      );
    });
    expect(screen.getByText(/Stop after the skill is installed\./i)).toBeTruthy();
    expect(screen.getAllByText("Install Only").length).toBeGreaterThan(0);
  });

  it("defaults to CLI install and can copy the compact prompt tab", async () => {
    render(
      <SkillCommandLineCard
        slug="weather"
        displayName="Weather"
        ownerHandle="steipete"
        ownerId={ownerPublisherId}
      />,
    );

    expect(screen.getByText("openclaw skills install weather")).toBeTruthy();
    expect(screen.queryByText("npx clawhub@latest install weather")).toBeNull();
    expect(screen.getByRole("tab", { name: "CLI" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Prompt" }).getAttribute("aria-selected")).toBe(
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy OpenClaw CLI command" }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("openclaw skills install weather");
    });

    fireEvent.click(screen.getByRole("tab", { name: "Prompt" }));

    expect(screen.getByText(/Install the skill "Weather"/i)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Prompt" }).getAttribute("aria-selected")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy OpenClaw prompt" }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(
        expect.stringContaining("After install, inspect the skill metadata"),
      );
    });
  });
});
