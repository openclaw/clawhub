/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();
let searchMock: {
  q?: string;
  type?: "all" | "skills" | "plugins";
  nonSuspicious?: boolean;
} = {};
const useUnifiedSearchMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component?: unknown; validateSearch?: unknown }) => ({
    __config: config,
    useSearch: () => searchMock,
  }),
  useNavigate: () => navigateMock,
}));

vi.mock("../lib/useUnifiedSearch", () => ({
  useUnifiedSearch: (...args: unknown[]) => useUnifiedSearchMock(...args),
}));

vi.mock("../components/PluginListItem", () => ({
  PluginListItem: ({ item }: { item: { name: string } }) => <div>{item.name}</div>,
}));

vi.mock("../components/SkillListItem", () => ({
  SkillListItem: ({ skill }: { skill: { slug: string } }) => <div>{skill.slug}</div>,
}));

vi.mock("../components/ui/card", () => ({
  Card: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

async function loadRoute() {
  return (await import("../routes/search")).Route as unknown as {
    __config: {
      component?: ComponentType;
    };
  };
}

describe("search route", () => {
  beforeEach(() => {
    searchMock = { q: "first" };
    navigateMock.mockReset();
    useUnifiedSearchMock.mockReset();
    useUnifiedSearchMock.mockReturnValue({
      results: [],
      skillResults: [],
      pluginResults: [],
      skillCount: 0,
      pluginCount: 0,
      isSearching: false,
    });
  });

  it("keeps the input synced with query param changes while mounted", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;
    const rendered = render(<Component />);

    const input = screen.getByPlaceholderText("Search skills and plugins...") as HTMLInputElement;
    expect(input.value).toBe("first");

    fireEvent.change(input, { target: { value: "draft" } });
    expect(input.value).toBe("draft");

    searchMock = { q: "second" };
    rendered.rerender(<Component />);

    expect(
      (screen.getByPlaceholderText("Search skills and plugins...") as HTMLInputElement).value,
    ).toBe("second");
  });

  it("does not render a public users search tab", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("button", { name: /users/i })).toBeNull();
  });

  it("shows zero counts consistently for active search tabs", async () => {
    useUnifiedSearchMock.mockReturnValue({
      results: [],
      skillResults: [],
      pluginResults: [{ type: "plugin", plugin: { name: "github-plugin" } }],
      skillCount: 0,
      pluginCount: 3,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("button", { name: "All 3" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skills 0" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plugins 3" })).toBeTruthy();
  });

  it("clears the active search query from the input", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/search",
      search: { q: undefined, type: undefined },
      replace: true,
    });
  });

  it("can request more results from global search", async () => {
    searchMock = { q: "weather", type: "skills" };
    useUnifiedSearchMock.mockReturnValue({
      results: Array.from({ length: 25 }, (_, index) => ({
        type: "skill",
        skill: {
          _id: `skill-${index}`,
          slug: `weather-${index}`,
          displayName: `Weather ${index}`,
          ownerUserId: "users:1",
          stats: { downloads: 0, stars: 0 },
          updatedAt: 1,
          createdAt: 1,
        },
        ownerHandle: "clawhub",
        score: 1,
      })),
      skillResults: [],
      pluginResults: [],
      skillCount: 25,
      pluginCount: 0,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(useUnifiedSearchMock).toHaveBeenLastCalledWith("weather", "all", {
      limits: { skills: 25, plugins: 25 },
      nonSuspiciousOnly: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(useUnifiedSearchMock).toHaveBeenLastCalledWith("weather", "all", {
      limits: { skills: 50, plugins: 50 },
      nonSuspiciousOnly: true,
    });
  });

  it("defaults nonSuspiciousOnly to true when URL param is absent", async () => {
    searchMock = { q: "hello" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(useUnifiedSearchMock).toHaveBeenLastCalledWith(
      "hello",
      "all",
      expect.objectContaining({ nonSuspiciousOnly: true }),
    );
  });

  it("passes nonSuspiciousOnly=false to the hook when URL opts out", async () => {
    searchMock = { q: "hello", nonSuspicious: false };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(useUnifiedSearchMock).toHaveBeenLastCalledWith(
      "hello",
      "all",
      expect.objectContaining({ nonSuspiciousOnly: false }),
    );
  });

  it("shows the 'Hiding suspicious skills' chip by default and opts out on click", async () => {
    searchMock = { q: "hello" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const chip = screen.getByRole("button", { name: /Hiding suspicious skills/i });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.textContent).toContain("Show all");

    fireEvent.click(chip);

    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/search",
        replace: true,
        search: expect.objectContaining({ nonSuspicious: false }),
      }),
    );
  });

  it("shows the 'Showing all skills' chip when opted out and clears the URL param on click", async () => {
    searchMock = { q: "hello", nonSuspicious: false };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const chip = screen.getByRole("button", { name: /Showing all skills/i });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(chip.textContent).toContain("Hide suspicious");

    fireEvent.click(chip);

    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/search",
        replace: true,
        search: expect.objectContaining({ nonSuspicious: undefined }),
      }),
    );
  });

  it("hides the suspicious-filter chip on the plugins tab", async () => {
    searchMock = { q: "hello", type: "plugins" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("button", { name: /suspicious/i })).toBeNull();
  });
});
