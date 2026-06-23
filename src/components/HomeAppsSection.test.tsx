/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

import { HomeAppsSection } from "./HomeAppsSection";

describe("HomeAppsSection", () => {
  it.each([
    ["GitHub", "/app-icons/github.svg"],
    ["VS Code", "/app-icons/vscode.svg"],
    ["Notion", "/app-icons/notion.svg"],
    ["Gmail", "/app-icons/google-gmail.svg"],
    ["Google Drive", "/app-icons/google-drive.svg"],
    ["Google Sheets", "/app-icons/google-sheets.svg"],
    ["Google Calendar", "/app-icons/google-calendar.svg"],
    ["Slack", "/app-icons/slack.svg"],
    ["Linear", "/app-icons/linear.svg"],
    ["Figma", "/app-icons/figma.svg"],
    ["Trello", "/app-icons/atlassian-trello.svg"],
    ["WhatsApp", "/app-icons/whatsapp.svg"],
  ])("uses the local SVG for %s without changing its image dimensions", (name, iconPath) => {
    render(<HomeAppsSection />);

    const image = screen.getByText(name).closest("a")?.querySelector("img");

    expect(image?.getAttribute("src")).toBe(iconPath);
    expect(image?.getAttribute("width")).toBe("40");
    expect(image?.getAttribute("height")).toBe("40");
  });

  it.each(["Popular", "Chat", "Docs & specs", "Web", "Cloud"])(
    "uses only local SVGs for %s cards",
    (category) => {
      render(<HomeAppsSection />);

      if (category !== "Popular") {
        fireEvent.click(screen.getByRole("tab", { name: category }));
      }

      const remoteSources = Array.from(
        document.querySelectorAll<HTMLImageElement>(".home-v2-apps-tile img"),
      )
        .map((image) => image.getAttribute("src") ?? "")
        .filter((src) => src.startsWith("https://www.google.com/s2/favicons"));

      expect(remoteSources).toEqual([]);
    },
  );

  it("keeps workflow brand SVGs in the shared app icon directory", () => {
    render(<HomeAppsSection />);

    expect(
      document.querySelector<HTMLImageElement>(".home-v2-apps-workflow-tile.is-openai img")?.src,
    ).toContain("/app-icons/openai.svg");
    expect(
      document.querySelector<HTMLImageElement>(".home-v2-apps-workflow-tile.is-slack img")?.src,
    ).toContain("/app-icons/slack.svg");
    expect(
      document.querySelector<HTMLImageElement>(".home-v2-apps-workflow-tile.is-openclaw img")?.src,
    ).toContain("/app-icons/openclaw.svg");
  });

  it("uses the normalized local Groq asset on the Cloud tab", () => {
    render(<HomeAppsSection />);

    fireEvent.click(screen.getByRole("tab", { name: "Cloud" }));
    const image = screen.getByText("Groq").closest("a")?.querySelector("img");

    expect(image?.getAttribute("src")).toBe("/app-icons/groq.svg");
  });

  it("uses the local Google Chrome asset on the Web tab", () => {
    render(<HomeAppsSection />);

    fireEvent.click(screen.getByRole("tab", { name: "Web" }));
    const image = screen.getByText("Google Chrome").closest("a")?.querySelector("img");

    expect(image?.getAttribute("src")).toBe("/app-icons/google-chrome.svg");
  });

  it("rounds only local SVGs that include their own background", () => {
    render(<HomeAppsSection />);

    expect(screen.getByText("Notion").closest("a")?.querySelector("img")?.className).not.toContain(
      "home-v2-apps-tile-logo--has-background",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Docs & specs" }));

    expect(screen.getByText("Jira").closest("a")?.querySelector("img")?.className).toContain(
      "home-v2-apps-tile-logo--has-background",
    );
    expect(screen.getByText("Figma").closest("a")?.querySelector("img")?.className).not.toContain(
      "home-v2-apps-tile-logo--has-background",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Cloud" }));

    expect(screen.getByText("llama.cpp").closest("a")?.querySelector("img")?.className).toContain(
      "home-v2-apps-tile-logo--has-background",
    );
    expect(screen.getByText("GitLab").closest("a")?.querySelector("img")?.className).not.toContain(
      "home-v2-apps-tile-logo--has-background",
    );
  });
});
