/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

import { HomeAppsSection } from "./HomeAppsSection";

const simpleIcon = (slug: string) =>
  `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${slug}.svg`;

function iconForCard(name: string) {
  return screen.getByText(name).closest("a")?.querySelector<HTMLElement>(".home-v2-apps-tile-logo");
}

function expectSimpleIcon(element: HTMLElement | null | undefined, slug: string, color: string) {
  expect(element?.dataset.simpleIconSlug).toBe(slug);
  expect(element?.style.getPropertyValue("--home-simple-icon-url")).toBe(
    `url("${simpleIcon(slug)}")`,
  );
  expect(element?.style.getPropertyValue("--home-simple-icon-color")).toBe(color);
}

describe("HomeAppsSection", () => {
  it.each([
    ["GitHub", "github", "#181717"],
    ["VS Code", "visualstudiocode", "#007ACC"],
    ["Notion", "notion", "#000000"],
    ["Slack", "slack", "#4A154B"],
    ["Gmail", "gmail", "#EA4335"],
    ["Google Drive", "googledrive", "#4285F4"],
    ["Google Sheets", "googlesheets", "#34A853"],
    ["Google Calendar", "googlecalendar", "#4285F4"],
    ["Linear", "linear", "#5E6AD2"],
    ["Figma", "figma", "#F24E1E"],
    ["Trello", "trello", "#0052CC"],
    ["WhatsApp", "whatsapp", "#25D366"],
  ])("uses the Simple Icons SVG mask and brand fill for %s", (name, slug, color) => {
    render(<HomeAppsSection />);

    expectSimpleIcon(iconForCard(name), slug, color);
  });

  it.each(["Popular", "Chat", "Docs & specs", "Web", "Cloud"])(
    "does not fall back to Google favicon scraping for %s cards",
    (category) => {
      render(<HomeAppsSection />);

      if (category !== "Popular") {
        fireEvent.click(screen.getByRole("tab", { name: category }));
      }

      const remoteSources = Array.from(
        document.querySelectorAll<HTMLElement>(".home-v2-apps-tile-logo"),
      )
        .map((icon) => icon.style.getPropertyValue("--home-simple-icon-url"))
        .filter((src) => src.startsWith("https://www.google.com/s2/favicons"));

      expect(remoteSources).toEqual([]);
    },
  );

  it("uses Simple Icons for workflow header marks too", () => {
    render(<HomeAppsSection />);

    expectSimpleIcon(
      document.querySelector<HTMLElement>(
        ".home-v2-apps-workflow-tile.is-openai .home-v2-apps-workflow-logo",
      ),
      "openai",
      "#412991",
    );
    expectSimpleIcon(
      document.querySelector<HTMLElement>(
        ".home-v2-apps-workflow-tile.is-slack .home-v2-apps-workflow-logo",
      ),
      "slack",
      "#4A154B",
    );
    expectSimpleIcon(
      document.querySelector<HTMLElement>(
        ".home-v2-apps-workflow-tile.is-openclaw .home-v2-apps-workflow-logo",
      ),
      "simpleicons",
      "#111111",
    );
  });

  it("uses exact Simple Icons slugs where they are available", () => {
    render(<HomeAppsSection />);

    fireEvent.click(screen.getByRole("tab", { name: "Cloud" }));

    expectSimpleIcon(iconForCard("AWS"), "amazonwebservices", "#232F3E");
    expectSimpleIcon(iconForCard("Amazon Bedrock"), "amazonwebservices", "#232F3E");

    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));

    expectSimpleIcon(iconForCard("Slack"), "slack", "#4A154B");
    expectSimpleIcon(iconForCard("Microsoft Teams"), "microsoftteams", "#6264A7");
    expectSimpleIcon(iconForCard("Voice Call"), "twilio", "#F22F46");
  });

  it("uses Simple Icons placeholders for brands missing exact Simple Icons slugs", () => {
    render(<HomeAppsSection />);

    fireEvent.click(screen.getByRole("tab", { name: "Cloud" }));

    expectSimpleIcon(iconForCard("Groq"), "simpleicons", "#111111");
    expectSimpleIcon(iconForCard("DeepInfra"), "simpleicons", "#111111");
    expectSimpleIcon(iconForCard("Cerebras"), "simpleicons", "#111111");

    fireEvent.click(screen.getByRole("tab", { name: "Web" }));

    expectSimpleIcon(iconForCard("Exa"), "simpleicons", "#111111");
    expectSimpleIcon(iconForCard("Firecrawl"), "simpleicons", "#111111");
    expectSimpleIcon(iconForCard("ScraperAPI"), "simpleicons", "#111111");
    expectSimpleIcon(iconForCard("Parallel"), "simpleicons", "#111111");

    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));

    expectSimpleIcon(iconForCard("Feishu/Lark"), "simpleicons", "#111111");
  });

  it("uses the Simple Icons SVG asset for Google Chrome on the Web tab", () => {
    render(<HomeAppsSection />);

    fireEvent.click(screen.getByRole("tab", { name: "Web" }));

    expectSimpleIcon(iconForCard("Google Chrome"), "googlechrome", "#4285F4");
  });

  it("does not apply old local SVG background clipping treatment", () => {
    render(<HomeAppsSection />);

    expect(iconForCard("Notion")?.className).not.toContain(
      "home-v2-apps-tile-logo--has-background",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Docs & specs" }));

    expect(iconForCard("Jira")?.className).not.toContain("home-v2-apps-tile-logo--has-background");
    expect(iconForCard("Figma")?.className).not.toContain("home-v2-apps-tile-logo--has-background");

    fireEvent.click(screen.getByRole("tab", { name: "Cloud" }));

    expect(iconForCard("llama.cpp")?.className).not.toContain(
      "home-v2-apps-tile-logo--has-background",
    );
    expect(iconForCard("AWS")?.className).not.toContain("home-v2-apps-tile-logo--has-background");
    expect(iconForCard("GitLab")?.className).not.toContain(
      "home-v2-apps-tile-logo--has-background",
    );
  });
});
