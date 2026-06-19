/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPENCLAW_SKILLS_DISCORD_URL,
  SkillPublishSuccessDialog,
} from "./SkillPublishSuccessDialog";

const writeTextMock = vi.fn();

function renderDialog(overrides: Partial<Parameters<typeof SkillPublishSuccessDialog>[0]> = {}) {
  return render(
    <SkillPublishSuccessDialog
      isOpen
      displayName="Agent Helper"
      skillPath="/vyctor/agent-helper"
      skill={{
        slug: "agent-helper",
        displayName: "Agent Helper",
        categories: ["development"],
        icon: "lucide:Plug",
      }}
      publisher={{ displayName: "Vyctor", handle: "vyctor", kind: "user" }}
      categoryLabel="Developer tools"
      onDismiss={vi.fn()}
      {...overrides}
    />,
  );
}

describe("SkillPublishSuccessDialog", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
  });

  it("offers Discord, Twitter, and the published skill link", () => {
    renderDialog();

    expect(screen.getByRole("heading", { name: /It's alive!/i })).toBeTruthy();
    expect(screen.getAllByText("Agent Helper").length).toBeGreaterThan(0);
    expect(screen.getByText("Vyctor")).toBeTruthy();
    expect(screen.queryByText("v1.0.0")).toBeNull();
    expect(screen.getByText("Developer tools")).toBeTruthy();
    expect(screen.getByText("#skills")).toBeTruthy();
    expect(screen.getByText("Friends of the Crustacean 🦞🤝")).toBeTruthy();

    const discordLink = screen.getByRole("link", { name: /Share on Discord/i });
    expect(discordLink.getAttribute("href")).toBe(OPENCLAW_SKILLS_DISCORD_URL);

    const xLink = screen.getByRole("link", { name: /Share on Twitter/i });
    const xHref = xLink.getAttribute("href") ?? "";
    expect(xHref).toContain("https://twitter.com/intent/tweet?");
    const xParams = new URL(xHref).searchParams;
    expect(xParams.get("text")).toBe(
      "Agent Helper is now live on ClawHub 🦞 Check it out: https://clawhub.ai/vyctor/agent-helper",
    );
    expect(xParams.get("url")).toBeNull();
  });

  it("moves focus into the dialog without highlighting a secondary action", async () => {
    renderDialog();

    const dialog = screen.getByRole("dialog");
    await waitFor(() => {
      expect(document.activeElement).toBe(dialog);
    });
    expect(screen.getByRole("button", { name: /Copy skill link/i })).not.toBe(
      document.activeElement,
    );
  });

  it.each(["http://127.0.0.1:3030", "http://localhost:3030", "http://[::1]:3030"])(
    "shares the public ClawHub URL instead of local dev origin %s",
    (localOrigin) => {
      vi.stubEnv("VITE_SITE_URL", localOrigin);

      renderDialog();

      const skillLink = screen.getByRole("link", { name: "clawhub.ai/vyctor/agent-helper" });
      expect(skillLink.getAttribute("href")).toBe("https://clawhub.ai/vyctor/agent-helper");
    },
  );

  it("copies the skill link from the inline copy action", async () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /Copy skill link/i }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining("/vyctor/agent-helper"));
    });
    expect(screen.getByText("Copied")).toBeTruthy();
  });

  it("copies a ready Discord message before opening the Discord channel", async () => {
    renderDialog();

    fireEvent.click(screen.getByRole("link", { name: /Share on Discord/i }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(
        "I just published Agent Helper on ClawHub: https://clawhub.ai/vyctor/agent-helper",
      );
    });
  });

  it("dismisses from the View skill action", () => {
    const onDismiss = vi.fn();
    renderDialog({ onDismiss });

    fireEvent.click(screen.getByRole("button", { name: /View skill/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
