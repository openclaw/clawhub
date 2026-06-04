/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();
const convexQueryMock = vi.fn();
const fetchPluginCatalogMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    to,
  }: {
    children: React.ReactNode;
    className?: string;
    to?: string;
  }) => (
    <a className={className} href={typeof to === "string" ? to : "/"}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
}));

vi.mock("../convex/client", () => ({
  convexHttp: {
    query: (...args: unknown[]) => convexQueryMock(...args),
  },
}));

vi.mock("../../convex/_generated/api", () => ({
  api: {
    skills: {
      listPublicPageV4: "skills:listPublicPageV4",
    },
  },
}));

vi.mock("../lib/packageApi", () => ({
  fetchPluginCatalog: (...args: unknown[]) => fetchPluginCatalogMock(...args),
}));

import { HomeListingSection } from "../components/HomeListingSection";

describe("HomeListingSection", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    convexQueryMock.mockReset();
    fetchPluginCatalogMock.mockReset();
    convexQueryMock.mockResolvedValue({
      page: [
        {
          skill: {
            _id: "skills:1",
            slug: "demo-skill",
            displayName: "Demo Skill",
            summary: "A helpful skill.",
            stats: { stars: 12, downloads: 340 },
          },
          ownerHandle: "builder",
        },
      ],
    });
    fetchPluginCatalogMock.mockResolvedValue({
      items: [
        {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          summary: "Runs workflows.",
          createdAt: 1,
          updatedAt: 2,
          latestVersion: "1.0.0",
        },
      ],
      nextCursor: null,
    });
  });

  it("renders the listing toolbar and skill cards by default", async () => {
    render(<HomeListingSection />);

    expect(screen.getByRole("group", { name: "Content type" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Latest" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Demo Skill")).toBeTruthy();
    });
  });

  it("switches to plugins and loads plugin cards", async () => {
    render(<HomeListingSection />);

    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));

    await waitFor(() => {
      expect(screen.getByText("Demo Plugin")).toBeTruthy();
    });
    expect(fetchPluginCatalogMock).toHaveBeenCalled();
  });

  it("navigates to browse when filter is clicked", async () => {
    render(<HomeListingSection />);

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));

    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/skills",
      }),
    );
  });
});
