/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InstallCommandCard,
  OpenClawCliInstallCommand,
  SkillCommandLineCard,
} from "./SkillInstallSurface";
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

    expect(screen.getByText("Install the @steipete/weather skill from ClawHub")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prompt" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy OpenClaw prompt" }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(
        "Install the @steipete/weather skill from ClawHub",
      );
    });
  });

  it("splits plugin install commands into muted verb and highlighted target", () => {
    render(<OpenClawCliInstallCommand command="openclaw plugins install @composio/composio" />);

    expect(screen.getByText("openclaw plugins install")).toBeTruthy();
    expect(screen.getByText("@composio/composio")).toBeTruthy();
  });

  it.each(["plugins", "skills", "templates"] as const)(
    "defaults a supported %s identity to Desktop and reuses the CLI shell when switched",
    async (family) => {
      const command = `openclaw ${family} install @owner/example`;
      render(
        <InstallCommandCard
          cliCommand={command}
          prompt="Legacy prompt"
          desktopInstall={{ family, name: "@owner/example" }}
          secondaryInstall={{
            label: "npx skills",
            command: "npx skills add example",
            copyAriaLabel: "Copy skills",
          }}
        />,
      );
      const link = screen.getByRole("link", { name: "Install in OpenClaw" });
      expect(link.getAttribute("href")).toBe(
        `openclaw://${family}/install?name=%40owner%2Fexample`,
      );
      expect(link.closest(".skill-install-command-card")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Desktop" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(screen.queryByRole("button", { name: "Prompt" })).toBeNull();
      expect(screen.queryByRole("button", { name: "npx skills" })).toBeNull();
      expect(document.querySelector(".skill-install-command-shell")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "CLI" }));
      expect(screen.queryByRole("link", { name: "Install in OpenClaw" })).toBeNull();
      expect(document.querySelector(".skill-install-command-shell-cli pre")?.textContent).toBe(
        command,
      );
      fireEvent.click(screen.getByRole("button", { name: "Copy OpenClaw CLI command" }));
      await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(command));
      fireEvent.click(screen.getByRole("button", { name: "Desktop" }));
      expect(screen.getByRole("link", { name: "Install in OpenClaw" })).toBeTruthy();
    },
  );

  it("reveals the full CLI command on keyboard focus without changing copied text", async () => {
    const command = "openclaw plugins install clawhub:@owner/a-very-long-plugin-name@latest";
    const { container } = render(
      <InstallCommandCard cliCommand={command} prompt="Legacy prompt" />,
    );
    const preview = container.querySelector<HTMLPreElement>(".skill-install-command")!;
    expect(preview.textContent).toBe(command);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.focus(preview);
    expect((await screen.findByRole("tooltip")).textContent).toBe(command);
    fireEvent.keyDown(preview, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Copy OpenClaw CLI command" }));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(command));
    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(container.querySelector(".skill-install-prompt-compact")?.textContent).toBe(
      "Legacy prompt",
    );
  });

  it("falls back to CLI if desktop availability is revoked while selected", () => {
    const props = { cliCommand: "openclaw skills install @owner/example", prompt: "Legacy prompt" };
    const { rerender } = render(
      <InstallCommandCard
        {...props}
        desktopInstall={{ family: "skills", name: "@owner/example" }}
      />,
    );
    expect(screen.getByRole("link", { name: "Install in OpenClaw" })).toBeTruthy();
    rerender(<InstallCommandCard {...props} />);
    expect(screen.queryByRole("link", { name: "Install in OpenClaw" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Desktop" })).toBeNull();
    expect(document.querySelector(".skill-install-command")?.textContent).toBe(props.cliCommand);
  });
});
