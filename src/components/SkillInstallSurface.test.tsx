/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenClawCliInstallCommand, SkillCommandLineCard } from "./SkillInstallSurface";
import { TooltipProvider } from "./ui/tooltip";

const writeTextMock = vi.fn();

describe("skill install commands", () => {
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

  it("defaults to CLI install and can copy the compact prompt tab", async () => {
    render(
      <TooltipProvider>
        <SkillCommandLineCard slug="weather" ownerHandle="steipete" ownerId={ownerPublisherId} />
      </TooltipProvider>,
    );

    expect(screen.getByRole("heading", { name: "Install" })).toBeTruthy();
    expect(screen.getByText("openclaw skills install")).toBeTruthy();
    expect(screen.getByText("@steipete/weather")).toBeTruthy();
    expect(document.querySelector(".skill-install-command-verb")?.textContent).toBe(
      "openclaw skills install",
    );
    expect(document.querySelector(".skill-install-command-target")?.textContent).toBe(
      " @steipete/weather",
    );
    expect(screen.queryByText("npx clawhub@latest install @steipete/weather")).toBeNull();
    expect(screen.getByRole("button", { name: "CLI" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Prompt" }).getAttribute("aria-pressed")).toBe(
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy OpenClaw CLI command" }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("openclaw skills install @steipete/weather");
    });

    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));

    expect(screen.getByText("install @steipete/weather from ClawHub")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prompt" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy OpenClaw prompt" }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith("install @steipete/weather from ClawHub");
    });
  });

  it("splits plugin install commands into muted verb and highlighted target", () => {
    render(<OpenClawCliInstallCommand command="openclaw plugins install @composio/composio" />);

    expect(screen.getByText("openclaw plugins install")).toBeTruthy();
    expect(screen.getByText("@composio/composio")).toBeTruthy();
  });
});
