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

describe("HomeAppsSection", () => {
  it.each([
    ["GitHub", simpleIcon("github")],
    ["VS Code", simpleIcon("visualstudiocode")],
    ["Notion", simpleIcon("notion")],
    ["Slack", simpleIcon("slack")],
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
    ).toBe(simpleIcon("openai"));
    expect(
      document.querySelector<HTMLImageElement>(".home-v2-apps-workflow-tile.is-slack img")?.src,
    ).toBe(simpleIcon("slack"));
    expect(
      document.querySelector<HTMLImageElement>(".home-v2-apps-workflow-tile.is-openclaw img")?.src,
    ).toBe(simpleIcon("simpleicons"));
  });

  it("uses exact Simple Icons slugs where they are available", () => {
    render(<HomeAppsSection />);

    fireEvent.click(screen.getByRole("tab", { name: "Cloud" }));
    const awsImage = screen.getByText("AWS").closest("a")?.querySelector("img");
    const bedrockImage = screen.getByText("Amazon Bedrock").closest("a")?.querySelector("img");

    expect(awsImage?.getAttribute("src")).toBe(simpleIcon("amazonwebservices"));
    expect(bedrockImage?.getAttribute("src")).toBe(simpleIcon("amazonwebservices"));

    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));

    expect(screen.getByText("Slack").closest("a")?.querySelector("img")?.getAttribute("src")).toBe(
      simpleIcon("slack"),
    );
    expect(
      screen.getByText("Microsoft Teams").closest("a")?.querySelector("img")?.getAttribute("src"),
    ).toBe(simpleIcon("microsoftteams"));
    expect(
      screen.getByText("Voice Call").closest("a")?.querySelector("img")?.getAttribute("src"),
    ).toBe(simpleIcon("twilio"));
  });

  it("uses Simple Icons placeholders for brands missing exact Simple Icons slugs", () => {
    render(<HomeAppsSection />);

    fireEvent.click(screen.getByRole("tab", { name: "Cloud" }));
    const groqImage = screen.getByText("Groq").closest("a")?.querySelector("img");
    const deepInfraImage = screen.getByText("DeepInfra").closest("a")?.querySelector("img");
    const cerebrasImage = screen.getByText("Cerebras").closest("a")?.querySelector("img");

    expect(groqImage?.getAttribute("src")).toBe(simpleIcon("simpleicons"));
    expect(deepInfraImage?.getAttribute("src")).toBe(simpleIcon("simpleicons"));
    expect(cerebrasImage?.getAttribute("src")).toBe(simpleIcon("simpleicons"));

    fireEvent.click(screen.getByRole("tab", { name: "Web" }));

    expect(screen.getByText("Exa").closest("a")?.querySelector("img")?.getAttribute("src")).toBe(
      simpleIcon("simpleicons"),
    );
    expect(
      screen.getByText("Firecrawl").closest("a")?.querySelector("img")?.getAttribute("src"),
    ).toBe(simpleIcon("simpleicons"));
    expect(
      screen.getByText("ScraperAPI").closest("a")?.querySelector("img")?.getAttribute("src"),
    ).toBe(simpleIcon("simpleicons"));
    expect(
      screen.getByText("Parallel").closest("a")?.querySelector("img")?.getAttribute("src"),
    ).toBe(simpleIcon("simpleicons"));

    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));

    expect(
      screen.getByText("Feishu/Lark").closest("a")?.querySelector("img")?.getAttribute("src"),
    ).toBe(simpleIcon("simpleicons"));
  });

  it("uses the Simple Icons SVG asset for Google Chrome on the Web tab", () => {
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
