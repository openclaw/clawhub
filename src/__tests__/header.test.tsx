/* @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type HeaderAuthStatus = {
  isAuthenticated: boolean;
  isLoading: boolean;
  me: Record<string, unknown> | null;
};

const siteModeMock = vi.fn(() => "souls");
const navigateMock = vi.fn();
const { useUnifiedSearchMock } = vi.hoisted(() => ({
  useUnifiedSearchMock: vi.fn(),
}));

const defaultUnifiedSearchResult = {
  results: [],
  skillResults: [
    {
      type: "skill",
      ownerHandle: "local",
      score: 10,
      skill: {
        _id: "skills:weather",
        slug: "weather",
        displayName: "Weather Skill",
        ownerUserId: "users:local",
        stats: { downloads: 1, stars: 2 },
        createdAt: 1,
        updatedAt: 2,
      },
    },
  ],
  pluginResults: [
    {
      type: "plugin",
      plugin: {
        name: "weather-plugin",
        displayName: "Weather Plugin",
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        summary: "Plugin weather tools.",
        ownerHandle: "local",
        createdAt: 1,
        updatedAt: 2,
        latestVersion: "1.0.0",
        capabilityTags: [],
        executesCode: true,
        verificationTier: null,
      },
    },
  ],
  skillCount: 1,
  pluginCount: 1,
  isSearching: false,
};

vi.mock("@tanstack/react-router", () => ({
  Link: (props: { children: ReactNode; className?: string; hash?: string; to?: string }) => (
    <a href={`${props.to ?? "/"}${props.hash ? `#${props.hash}` : ""}`} className={props.className}>
      {props.children}
    </a>
  ),
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => navigateMock,
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

const authStatusMock = vi.fn<() => HeaderAuthStatus>(() => ({
  isAuthenticated: false,
  isLoading: false,
  me: null,
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => authStatusMock(),
}));

const setThemeMock = vi.fn();
const setModeMock = vi.fn();

vi.mock("../lib/theme", () => ({
  applyTheme: vi.fn(),
  THEME_OPTIONS: [
    { value: "claw", label: "Claw", description: "" },
    { value: "hub", label: "Hub", description: "" },
  ],
  useThemeMode: () => ({
    theme: "hub",
    mode: "system",
    setTheme: setThemeMock,
    setMode: setModeMock,
  }),
}));

vi.mock("../lib/theme-transition", () => ({
  startThemeTransition: ({
    setTheme,
    nextTheme,
  }: {
    setTheme: (value: string) => void;
    nextTheme: string;
  }) => setTheme(nextTheme),
}));

vi.mock("../lib/useAuthError", () => ({
  setAuthError: vi.fn(),
  useAuthError: () => ({
    error: null,
    clear: vi.fn(),
  }),
}));

vi.mock("../lib/roles", () => ({
  isModerator: () => false,
}));

vi.mock("../lib/site", () => ({
  getClawHubSiteUrl: () => "https://clawhub.ai",
  getSiteMode: () => siteModeMock(),
  getSiteName: () => "OnlyCrabs",
}));

vi.mock("../lib/gravatar", () => ({
  gravatarUrl: vi.fn(),
}));

vi.mock("../lib/useUnifiedSearch", () => ({
  useUnifiedSearch: () => useUnifiedSearchMock(),
}));

vi.mock("../components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../components/ui/toggle-group", () => ({
  ToggleGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ToggleGroupItem: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

import Header from "../components/Header";

describe("Header", () => {
  beforeEach(() => {
    authStatusMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      me: null,
    });
    siteModeMock.mockReturnValue("souls");
    useUnifiedSearchMock.mockReturnValue(defaultUnifiedSearchResult);
  });

  it("hides Packages navigation in soul mode on mobile and desktop", () => {
    siteModeMock.mockReturnValue("souls");

    render(<Header />);

    expect(screen.queryByText("Packages")).toBeNull();
  });

  it("renders simplified desktop nav and theme toggle", () => {
    siteModeMock.mockReturnValue("skills");
    setThemeMock.mockClear();
    setModeMock.mockClear();

    render(<Header />);

    expect(screen.getByRole("button", { name: /Toggle theme\. Current: system/i })).toBeTruthy();
    expect(screen.getAllByText("Skills")).toHaveLength(1);
    expect(screen.getAllByText("Plugins")).toHaveLength(1);
    expect(screen.queryByText("Users")).toBeNull();
    expect(screen.queryByText("Dashboard")).toBeNull();
    expect(screen.queryByText("Manage")).toBeNull();
    expect(screen.getByPlaceholderText("Search skills and plugins")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Toggle theme\. Current: system/i }));
    expect(setModeMock).toHaveBeenCalledWith("dark");

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    expect(screen.getAllByText("Home")).toHaveLength(1);
    expect(screen.getAllByText("Skills")).toHaveLength(2);
    expect(screen.getAllByText("Plugins")).toHaveLength(2);
  });

  it("shows grouped skills and plugins typeahead without users", () => {
    siteModeMock.mockReturnValue("skills");
    navigateMock.mockReset();

    render(<Header />);

    const input = screen.getByPlaceholderText("Search skills and plugins");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "weather" } });

    const typeahead = screen.getByRole("listbox");
    expect(within(typeahead).getByText("Skills")).toBeTruthy();
    expect(screen.getByText("Weather Skill")).toBeTruthy();
    expect(within(typeahead).getByText("Plugins")).toBeTruthy();
    expect(screen.getByText("Weather Plugin")).toBeTruthy();
    expect(within(typeahead).queryByText("Users")).toBeNull();
    expect(within(typeahead).queryByText('See user results for "weather"')).toBeNull();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/search",
      search: { q: "weather", type: "skills" },
    });
  });

  it("falls back to typed skill search when a typeahead skill has no owner handle", () => {
    siteModeMock.mockReturnValue("skills");
    navigateMock.mockReset();
    useUnifiedSearchMock.mockReturnValue({
      ...defaultUnifiedSearchResult,
      skillResults: [
        {
          ...defaultUnifiedSearchResult.skillResults[0],
          ownerHandle: null,
          skill: {
            ...defaultUnifiedSearchResult.skillResults[0].skill,
            ownerUserId: "users:opaque-id",
            ownerPublisherId: "publishers:opaque-id",
          },
        },
      ],
      pluginResults: [],
      pluginCount: 0,
    });

    render(<Header />);

    const input = screen.getByPlaceholderText("Search skills and plugins");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "weather" } });
    fireEvent.click(screen.getByRole("option", { name: /Weather Skill/i }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/search",
      search: { q: "weather", type: "skills" },
    });
    expect(navigateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/publishers%3Aopaque-id/weather",
      }),
    );
  });

  it("shows a single no-results state without section footers", () => {
    siteModeMock.mockReturnValue("skills");
    useUnifiedSearchMock.mockReturnValue({
      results: [],
      skillResults: [],
      pluginResults: [],
      skillCount: 0,
      pluginCount: 0,
      isSearching: false,
    });

    render(<Header />);

    const input = screen.getByPlaceholderText("Search skills and plugins");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "zzzz" } });

    const typeahead = screen.getByRole("listbox");
    expect(within(typeahead).getByText('No skills or plugins found for "zzzz"')).toBeTruthy();
    expect(within(typeahead).queryByText("Skills")).toBeNull();
    expect(within(typeahead).queryByText("Plugins")).toBeNull();
    expect(within(typeahead).queryByText('See skill results for "zzzz"')).toBeNull();
    expect(within(typeahead).queryByText('See plugin results for "zzzz"')).toBeNull();
  });

  it("shows Home above Skills in the mobile menu", () => {
    siteModeMock.mockReturnValue("skills");

    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    expect(document.querySelector(".mobile-nav-brand-mark-image")).toBeTruthy();

    const labels = Array.from(document.querySelectorAll(".mobile-nav-section .mobile-nav-link"))
      .map((element) => element.textContent?.trim())
      .filter((label): label is string => Boolean(label));

    expect(labels.slice(0, 2)).toEqual(["Home", "Skills"]);
  });

  it("keeps Stars out of signed-in header navigation", () => {
    siteModeMock.mockReturnValue("skills");
    authStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: {
        displayName: "Patrick",
        email: "patrick@example.com",
        handle: "patrick",
        image: null,
        name: "Patrick",
      },
    });

    render(<Header />);

    expect(screen.queryByText("Stars")).toBeNull();
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("routes soul-mode header searches to the souls browse page", () => {
    siteModeMock.mockReturnValue("souls");
    navigateMock.mockReset();

    render(<Header />);

    fireEvent.change(screen.getByPlaceholderText("Search souls..."), {
      target: { value: "angler" },
    });
    fireEvent.submit(screen.getByRole("search", { name: "Site search" }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/souls",
      search: {
        q: "angler",
        sort: undefined,
        dir: undefined,
        view: undefined,
        focus: undefined,
      },
    });
  });
});
