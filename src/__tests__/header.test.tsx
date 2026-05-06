/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

const setModeMock = vi.fn();

vi.mock("../lib/theme", () => ({
  applyTheme: vi.fn(),
  useThemeMode: () => ({
    theme: "claw",
    mode: "system",
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
  ToggleGroup: ({
    children,
    className,
    ...props
  }: {
    children: ReactNode;
    className?: string;
    "aria-label"?: string;
  }) => (
    <div className={className} aria-label={props["aria-label"]}>
      {children}
    </div>
  ),
  ToggleGroupItem: ({
    children,
    value,
    ...props
  }: {
    children: ReactNode;
    value?: string;
    "aria-label"?: string;
  }) => (
    <button type="button" aria-label={props["aria-label"]} data-value={value}>
      {children}
    </button>
  ),
}));

import Header from "../components/Header";

function stylesCss() {
  return readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
}

function compactHeaderCss() {
  const css = stylesCss();
  const start = css.indexOf("@media (max-width: 760px)");
  const end = css.indexOf("@media (max-width: 520px)", start);
  return css.slice(start, end);
}

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

  it("renders restored desktop nav rows and segmented theme controls", () => {
    siteModeMock.mockReturnValue("skills");
    setModeMock.mockClear();

    render(<Header />);

    expect(document.querySelector(".navbar-tabs")).toBeTruthy();
    expect(document.querySelector(".navbar-tabs-secondary")).toBeTruthy();
    expect(document.querySelector(".theme-mode-toggle")).toBeTruthy();
    expect(screen.getByLabelText("Theme mode").className).toContain("theme-mode-toggle");
    expect(screen.getByRole("button", { name: /Cycle theme mode/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "System theme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Light theme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dark theme" })).toBeTruthy();
    expect(screen.getAllByText("Skills")).toHaveLength(1);
    expect(screen.getAllByText("Plugins")).toHaveLength(1);
    expect(screen.getAllByText("Users")).toHaveLength(1);
    expect(screen.getAllByText("About")).toHaveLength(1);
    expect(screen.queryByText("Dashboard")).toBeNull();
    expect(screen.queryByText("Manage")).toBeNull();
    expect(screen.getByPlaceholderText("Search skills, plugins, users")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Cycle theme mode/i }));
    expect(setModeMock).toHaveBeenCalledWith("light");

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    expect(screen.getAllByText("Home")).toHaveLength(1);
    expect(screen.getAllByText("Skills")).toHaveLength(2);
    expect(screen.getAllByText("Plugins")).toHaveLength(2);
    expect(screen.getAllByText("Users")).toHaveLength(2);
    expect(screen.getAllByText("About")).toHaveLength(2);
  });

  it("renders the GitHub sign-in button with desktop and compact labels", () => {
    siteModeMock.mockReturnValue("skills");

    render(<Header />);

    const signInButton = screen.getByRole("button", { name: "Sign in with GitHub" });
    expect(signInButton.className).toContain("github-sign-in-button");
    const fullCopy = signInButton.querySelector(".sign-in-full-copy");
    expect(fullCopy?.textContent).toBe("Sign in with GitHub");
    expect(fullCopy?.childNodes).toHaveLength(1);
    expect(signInButton.querySelector(".sign-in-with")).toBeNull();
    expect(signInButton.querySelector(".sign-in-compact-copy")?.textContent).toBe("GitHub");
  });

  it("keeps inline search and moves content nav into the compact menu", () => {
    const css = compactHeaderCss();

    expect(css).toContain(".navbar-search-wrap");
    expect(css).toContain("grid-template-columns");
    expect(css).toContain(".navbar-search {");
    expect(css).toContain("display: flex;");
    expect(css).toContain(".navbar-search-mobile-trigger");
    expect(css).toContain("display: none;");
    expect(css).toContain(".navbar-tabs {");
    expect(css).toContain("display: none;");
    expect(css).toContain(".nav-mobile {");
    expect(css).toContain("display: inline-flex;");
    expect(css).not.toContain(".navbar-search {\n    display: none;");
  });

  it("aligns the restored header shell to the browse page width", () => {
    const css = stylesCss();
    const compactCss = compactHeaderCss();

    expect(css).toContain(".navbar-inner {\n  width: 100%;\n  max-width: var(--page-max);");
    expect(css).toContain("margin: 0 auto;\n  padding: 0 var(--space-5);");
    expect(compactCss).toContain("padding: 10px 16px;");
    expect(compactCss).toContain(".navbar-tabs {\n    display: none;");
    expect(css).not.toContain(".navbar-inner,\n  .section.detail-page-section");
  });

  it("shows grouped skills and plugins typeahead without users", () => {
    siteModeMock.mockReturnValue("skills");
    navigateMock.mockReset();

    render(<Header />);

    const input = screen.getByPlaceholderText("Search skills, plugins, users");
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

    const input = screen.getByPlaceholderText("Search skills, plugins, users");
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

    const input = screen.getByPlaceholderText("Search skills, plugins, users");
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
