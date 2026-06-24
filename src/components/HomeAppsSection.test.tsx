/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

import { HomeAppsSection } from "./HomeAppsSection";

const simpleIcon = (slug: string) => `https://cdn.simpleicons.org/${slug}/171717/f5f5f5`;

describe("HomeAppsSection", () => {
  it.each([
    ["GitHub", simpleIcon("github")],
    ["VS Code", simpleIcon("vscodium")],
    ["Notion", simpleIcon("notion")],
    ["Slack", simpleIcon("simpleicons")],
    ["Gmail", simpleIcon("gmail")],
    ["Google Drive", simpleIcon("googledrive")],
    ["Google Sheets", simpleIcon("googlesheets")],
    ["Google Calendar", simpleIcon("googlecalendar")],
    ["Linear", simpleIcon("linear")],
    ["Figma", simpleIcon("figma")],
    ["Trello", simpleIcon("trello")],
    ["WhatsApp", simpleIcon("whatsapp")],
  ])("uses the Simple Icons CDN for %s without changing its image dimensions", (name, iconPath) => {
    render(<HomeAppsSection />);

    const image = screen.getByText(name).closest("a")?.querySelector("img");

    expect(image?.getAttribute("src")).toBe(iconPath);
    expect(image?.getAttribute("width")).toBe("40");
    expect(image?.getAttribute("height")).toBe("40");
  });

  it.each(["Popular", "Chat", "Docs & specs", "Web", "Cloud"])(
    "does not fall back to Google favicon scraping for %s cards",
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

  it("uses Simple Icons for workflow header marks too", () => {
    render(<HomeAppsSection />);

    expect(
      document.querySelector<HTMLImageElement>(".home-v2-apps-workflow-tile.is-openai img")?.src,
    ).toBe(simpleIcon("simpleicons"));
    expect(
      document.querySelector<HTMLImageElement>(".home-v2-apps-workflow-tile.is-slack img")?.src,
    ).toBe(simpleIcon("simpleicons"));
    expect(
      document.querySelector<HTMLImageElement>(".home-v2-apps-workflow-tile.is-openclaw img")?.src,
    ).toBe(simpleIcon("simpleicons"));
  });

  it("uses Simple Icons placeholders for brands missing exact Simple Icons slugs", () => {
    render(<HomeAppsSection />);

    fireEvent.click(screen.getByRole("tab", { name: "Cloud" }));
    const groqImage = screen.getByText("Groq").closest("a")?.querySelector("img");
    const awsImage = screen.getByText("AWS").closest("a")?.querySelector("img");

    expect(groqImage?.getAttribute("src")).toBe(simpleIcon("simpleicons"));
    expect(awsImage?.getAttribute("src")).toBe(simpleIcon("simpleicons"));
  });

  it("uses the Simple Icons dark/light endpoint for Google Chrome on the Web tab", () => {
    render(<HomeAppsSection />);

    fireEvent.click(screen.getByRole("tab", { name: "Web" }));
    const image = screen.getByText("Google Chrome").closest("a")?.querySelector("img");

    expect(image?.getAttribute("src")).toBe(simpleIcon("googlechrome"));
  });

  it("does not apply old local SVG background clipping treatment", () => {
    render(<HomeAppsSection />);

    expect(screen.getByText("Notion").closest("a")?.querySelector("img")?.className).not.toContain(
      "home-v2-apps-tile-logo--has-background",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Docs & specs" }));

    expect(screen.getByText("Jira").closest("a")?.querySelector("img")?.className).not.toContain(
      "home-v2-apps-tile-logo--has-background",
    );
    expect(screen.getByText("Figma").closest("a")?.querySelector("img")?.className).not.toContain(
      "home-v2-apps-tile-logo--has-background",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Cloud" }));

    expect(
      screen.getByText("llama.cpp").closest("a")?.querySelector("img")?.className,
    ).not.toContain("home-v2-apps-tile-logo--has-background");
    expect(screen.getByText("AWS").closest("a")?.querySelector("img")?.className).not.toContain(
      "home-v2-apps-tile-logo--has-background",
    );
    expect(screen.getByText("GitLab").closest("a")?.querySelector("img")?.className).not.toContain(
      "home-v2-apps-tile-logo--has-background",
    );
  });
});
