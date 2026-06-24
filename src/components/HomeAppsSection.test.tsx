/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { HomeAppsSection } from "./HomeAppsSection";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

function extractCssUrl(value: string) {
  return value.match(/^url\("(?<url>.*)"\)$/)?.groups?.url ?? null;
}

function collectRenderedSimpleIconUrls() {
  const urls = new Set<string>();

  for (const tab of screen.getAllByRole("tab")) {
    fireEvent.click(tab);

    for (const icon of document.querySelectorAll<HTMLElement>(
      ".home-v2-apps-tile-logo, .home-v2-apps-workflow-logo",
    )) {
      const url = extractCssUrl(icon.style.getPropertyValue("--home-simple-icon-url"));
      if (url) urls.add(url);
    }
  }

  return [...urls].sort();
}

describe("HomeAppsSection", () => {
  it("uses Simple Icons SVG assets that resolve successfully", async () => {
    render(<HomeAppsSection />);

    const iconUrls = collectRenderedSimpleIconUrls();
    expect(iconUrls.length).toBeGreaterThan(0);
    expect(iconUrls).toEqual(
      expect.arrayContaining([
        "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/slack.svg",
        "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/visualstudiocode.svg",
        "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/microsoftteams.svg",
        "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/amazonwebservices.svg",
      ]),
    );

    const failures: string[] = [];
    for (const url of iconUrls) {
      expect(url).toMatch(
        /^https:\/\/cdn\.jsdelivr\.net\/npm\/simple-icons@latest\/icons\/.+\.svg$/,
      );

      const response = await fetch(url);
      const body = await response.text();
      if (!response.ok || !body.includes("<svg")) {
        failures.push(`${response.status} ${url}`);
      }
    }

    expect(failures).toEqual([]);
  }, 30_000);
});
