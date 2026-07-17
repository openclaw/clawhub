/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginPublishSubmittedDialog } from "./PluginPublishSubmittedDialog";

const writeTextMock = vi.fn();

function renderDialog(overrides: Partial<Parameters<typeof PluginPublishSubmittedDialog>[0]> = {}) {
  return render(
    <PluginPublishSubmittedDialog
      isOpen
      plugin={{
        name: "Demo Plugin",
        path: "/vintageayu/plugins/demo-plugin",
        publisher: { displayName: "VintageAyu", handle: "vintageayu" },
      }}
      onDismiss={vi.fn()}
      {...overrides}
    />,
  );
}

describe("PluginPublishSubmittedDialog", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });
  });

  it("moves focus into the dialog instead of a secondary action", async () => {
    renderDialog();

    const dialog = screen.getByRole("dialog");
    await waitFor(() => {
      expect(document.activeElement).toBe(dialog);
    });
    expect(screen.getByRole("button", { name: "Copy plugin link" })).not.toBe(
      document.activeElement,
    );
  });

  it.each(["http://127.0.0.1:3030", "http://localhost:3030", "http://[::1]:3030"])(
    "uses the public ClawHub URL instead of local dev origin %s",
    (localOrigin) => {
      vi.stubEnv("VITE_SITE_URL", localOrigin);

      renderDialog();

      const pluginLink = screen.getByRole("link", {
        name: "clawhub.ai/vintageayu/plugins/demo-plugin",
      });
      expect(pluginLink.getAttribute("href")).toBe(
        "https://clawhub.ai/vintageayu/plugins/demo-plugin",
      );
    },
  );

  it("copies the canonical plugin link and confirms success", async () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Copy plugin link" }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(
        "https://clawhub.ai/vintageayu/plugins/demo-plugin",
      );
    });
    expect(await screen.findByRole("button", { name: "Copied plugin link" })).toBeTruthy();
    expect(screen.getByText("Copied")).toBeTruthy();
  });

  it("shows clipboard failures and allows retry", async () => {
    writeTextMock.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Copy plugin link" }));

    expect(await screen.findByRole("button", { name: "Plugin link copy failed" })).toBeTruthy();
    expect(screen.getByText("Copy failed")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Plugin link copy failed" }));
    expect(await screen.findByRole("button", { name: "Copied plugin link" })).toBeTruthy();
  });

  it("dismisses from the dialog close control", () => {
    const onDismiss = vi.fn();
    renderDialog({ onDismiss });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
