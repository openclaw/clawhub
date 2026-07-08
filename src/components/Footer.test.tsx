/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: (props: { children: ReactNode; to?: string }) => (
    <a href={props.to ?? "/"}>{props.children}</a>
  ),
}));

import { Footer } from "./Footer";

describe("Footer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockMatchMedia(matches: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  }

  it("renders the public footer columns and bottom platform links", () => {
    const { container } = render(<Footer />);

    const columns = container.querySelectorAll(".footer-col");
    expect(columns).toHaveLength(4);

    const browse = screen.getByRole("heading", { name: "Browse" }).closest(".footer-col");
    const publish = screen.getByRole("heading", { name: "Publish" }).closest(".footer-col");
    const ecosystem = screen.getByRole("heading", { name: "Ecosystem" }).closest(".footer-col");
    const community = screen.getByRole("heading", { name: "Community" }).closest(".footer-col");

    expect(browse).not.toBeNull();
    expect(publish).not.toBeNull();
    expect(ecosystem).not.toBeNull();
    expect(community).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Platform" })).toBeNull();

    expect(
      within(browse as HTMLElement)
        .getByRole("link", { name: "Skills" })
        .getAttribute("href"),
    ).toBe("/skills");
    expect(
      within(browse as HTMLElement)
        .getByRole("link", { name: "Plugins" })
        .getAttribute("href"),
    ).toBe("/plugins");
    expect(
      within(publish as HTMLElement)
        .getByRole("link", { name: "Publish Skill" })
        .getAttribute("href"),
    ).toBe("/skills/publish");
    expect(
      within(publish as HTMLElement)
        .getByRole("link", { name: "Publish Plugin" })
        .getAttribute("href"),
    ).toBe("/plugins/publish");
    expect(
      within(community as HTMLElement)
        .getByRole("link", { name: "GitHub" })
        .getAttribute("href"),
    ).toBe("https://github.com/openclaw/clawhub");
    expect(
      within(ecosystem as HTMLElement)
        .getByRole("link", { name: "OpenClaw" })
        .getAttribute("href"),
    ).toBe("https://openclaw.ai");
    expect(within(community as HTMLElement).queryByRole("link", { name: "About" })).toBeNull();
    expect(screen.getByRole("link", { name: "Status" }).getAttribute("href")).toBe(
      "https://clawhub.betteruptime.com",
    );
    expect(screen.getByRole("link", { name: "Deployed on Vercel" }).getAttribute("href")).toBe(
      "https://vercel.com",
    );
    expect(screen.getByRole("link", { name: "Powered by Convex" }).getAttribute("href")).toBe(
      "https://www.convex.dev",
    );
  });

  it("collapses footer sections by heading until toggled open", async () => {
    mockMatchMedia(true);
    render(<Footer />);

    const browseToggle = screen.getByRole("button", { name: "Browse" });
    const browseLinks = document.getElementById("footer-section-browse-links");

    expect(browseLinks).not.toBeNull();
    await waitFor(() => expect(browseToggle.getAttribute("aria-expanded")).toBe("false"));
    expect(browseLinks?.getAttribute("data-open")).toBe("false");
    expect(screen.queryByRole("button", { name: "Platform" })).toBeNull();

    fireEvent.click(browseToggle);

    expect(browseToggle.getAttribute("aria-expanded")).toBe("true");
    expect(browseLinks?.getAttribute("data-open")).toBe("true");
    expect(
      within(browseLinks as HTMLElement)
        .getByRole("link", { name: "Skills" })
        .getAttribute("href"),
    ).toBe("/skills");

    fireEvent.click(browseToggle);

    expect(browseToggle.getAttribute("aria-expanded")).toBe("false");
    expect(browseLinks?.getAttribute("data-open")).toBe("false");
  });
});
