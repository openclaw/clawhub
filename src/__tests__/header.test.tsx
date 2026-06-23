/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AriaAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type HeaderAuthStatus = {
  isAuthenticated: boolean;
  isLoading: boolean;
  me: Record<string, unknown> | null;
};

const navigateMock = vi.fn();
const { profileHandleMock, signInMock, useUnifiedSearchMock } = vi.hoisted(() => ({
  profileHandleMock: vi.fn(),
  signInMock: vi.fn(),
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
        categories: ["development"],
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
        categories: ["channels"],
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
  skillHasMore: false,
  pluginHasMore: false,
  isSearching: false,
};

vi.mock("@tanstack/react-router", () => ({
  Link: (props: {
    children: ReactNode;
    className?: string;
    hash?: string;
    params?: { handle?: string; slug?: string };
    to?: string;
  }) => {
    const to =
      props.to
        ?.replace("$handle", props.params?.handle ?? "$handle")
        .replace("$slug", props.params?.slug ?? "$slug") ?? "/";
    return (
      <a href={`${to}${props.hash ? `#${props.hash}` : ""}`} className={props.className}>
        {props.children}
      </a>
    );
  },
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => navigateMock,
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({
    signIn: signInMock,
    signOut: vi.fn(),
  }),
}));

vi.mock("convex/react", () => ({
  useQuery: () => profileHandleMock(),
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
  clearAuthError: vi.fn(),
  setAuthError: vi.fn(),
}));

vi.mock("../lib/site", () => ({
  SITE_NAME: "ClawHub",
}));

vi.mock("../lib/gravatar", () => ({
  gravatarUrl: vi.fn(),
}));

vi.mock("../lib/useUnifiedSearch", () => ({
  useUnifiedSearch: (...args: unknown[]) => useUnifiedSearchMock(...args),
}));

vi.mock("../components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    className,
    onClick,
    ...props
  }: {
    children: ReactNode;
    className?: string;
    onClick?: () => void;
    "aria-current"?: AriaAttributes["aria-current"];
    "aria-label"?: string;
    "data-status"?: string;
    title?: string;
  }) => (
    <div
      aria-current={props["aria-current"]}
      aria-label={props["aria-label"]}
      className={className}
      data-status={props["data-status"]}
      onClick={onClick}
      title={props.title}
    >
      {children}
    </div>
  ),
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
  let start = css.indexOf("@media (max-width: 760px)");
  while (start >= 0) {
    const nextMedia = css.indexOf("@media ", start + 1);
    const block = css.slice(start, nextMedia === -1 ? undefined : nextMedia);
    if (block.includes(".navbar-search-wrap") && block.includes(".nav-mobile")) {
      return block;
    }
    start = css.indexOf("@media (max-width: 760px)", start + 1);
  }
  throw new Error("Missing compact header media query");
}

const scrollIntoViewMock = vi.fn();

describe("Header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
    authStatusMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      me: null,
    });
    profileHandleMock.mockReturnValue(null);
    useUnifiedSearchMock.mockReturnValue(defaultUnifiedSearchResult);
    signInMock.mockReset();
    signInMock.mockResolvedValue({ signingIn: true });
  });

  it("renders calm text-only content links in the top navbar", () => {
    setModeMock.mockClear();

    render(<Header />);

    const topNav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(document.querySelector(".navbar-calm")).toBeTruthy();
    expect(document.querySelector(".navbar-calm-rail")).toBeTruthy();
    expect(document.querySelector(".navbar-top-links")).toBeNull();
    expect(document.querySelector(".navbar-tabs")).toBeNull();
    expect(document.querySelector(".theme-mode-toggle")).toBeNull();
    expect(document.querySelector('.brand-mark-image[src="/logo-transparent.png"]')).toBeTruthy();
    expect(within(topNav).getByText("Skills").closest("a")?.querySelector("svg")).toBeNull();
    expect(within(topNav).getByText("Plugins").closest("a")?.querySelector("svg")).toBeNull();
    expect(
      topNav.querySelector(
        '.navbar-calm-rail-link-secondary[href="https://docs.openclaw.ai/clawhub/"]',
      ),
    ).toBeTruthy();
    expect(
      topNav.querySelector('.navbar-calm-more-link[href="https://docs.openclaw.ai/clawhub/"]'),
    ).toBeTruthy();
    expect(screen.getAllByText("Skills")).toHaveLength(1);
    expect(screen.getAllByText("Plugins")).toHaveLength(1);
    expect(screen.getAllByText("Creators")).toHaveLength(1);
    expect(screen.getAllByText("Docs")).toHaveLength(2);
    expect(screen.queryByText("About")).toBeNull();
    expect(screen.queryByText("Dashboard")).toBeNull();
    expect(screen.queryByText("Manage")).toBeNull();
    expect(screen.getByPlaceholderText("Search skills and plugins")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    expect(screen.getAllByText("Home")).toHaveLength(1);
    expect(screen.getAllByText("Skills")).toHaveLength(2);
    expect(screen.getAllByText("Plugins")).toHaveLength(2);
    expect(screen.getAllByText("Creators")).toHaveLength(2);
    expect(screen.getAllByText("Docs")).toHaveLength(3);
    expect(screen.queryByText("About")).toBeNull();
  });

  it("renders theme mode controls as a compact row between Settings and Sign out", () => {
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

    expect(document.querySelector(".theme-mode-toggle")).toBeNull();
    expect(screen.queryByText("Theme")).toBeNull();

    const themeRow = document.querySelector(".user-dropdown-theme-row");
    const settings = screen.getByText("Settings");
    const signOut = screen.getByText("Sign out");

    expect(themeRow).toBeTruthy();
    expect(themeRow?.children).toHaveLength(3);
    expect(settings.compareDocumentPosition(themeRow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(themeRow!.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(themeRow?.previousElementSibling?.tagName).toBe("HR");
    expect(signOut.previousElementSibling?.tagName).toBe("HR");

    expect(screen.getByLabelText("System theme").getAttribute("aria-current")).toBe("true");
    expect(screen.getByLabelText("System theme").getAttribute("data-status")).toBe("active");
    expect(screen.getByLabelText("Light theme").getAttribute("aria-current")).toBeNull();
    fireEvent.click(screen.getByLabelText("Light theme"));
    expect(setModeMock).toHaveBeenCalledWith("light");
    fireEvent.click(screen.getByLabelText("Dark theme"));
    expect(setModeMock).toHaveBeenCalledWith("dark");
  });

  it("renders the GitHub sign-in button with desktop and compact labels", () => {
    render(<Header />);

    const signInButton = screen.getByRole("button", { name: "Sign in with GitHub" });
    expect(signInButton.className).toContain("github-sign-in-button");
    const fullCopy = signInButton.querySelector(".sign-in-full-copy");
    expect(fullCopy?.textContent).toBe("Sign in with GitHub");
    expect(fullCopy?.childNodes).toHaveLength(1);
    expect(signInButton.querySelector(".sign-in-with")).toBeNull();
    expect(signInButton.querySelector(".sign-in-compact-copy")?.textContent).toBe("Sign in");
  });

  it("shows an auth error when the GitHub sign-in request does not start", async () => {
    const { setAuthError } = await import("../lib/useAuthError");
    signInMock.mockResolvedValue({ signingIn: false });

    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));

    expect(signInMock).toHaveBeenCalledWith("github", { redirectTo: "/dashboard" });
    await waitFor(() => {
      expect(setAuthError).toHaveBeenCalledWith("Sign in failed. Please try again.");
    });
  });

  it("does not show an auth error when GitHub sign-in starts a redirect", async () => {
    const { setAuthError } = await import("../lib/useAuthError");
    signInMock.mockResolvedValue({
      signingIn: false,
      redirect: new URL("https://github.com/login/oauth/authorize"),
    });

    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));

    expect(signInMock).toHaveBeenCalledWith("github", { redirectTo: "/dashboard" });
    await Promise.resolve();
    expect(setAuthError).not.toHaveBeenCalled();
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
    expect(compactCss).toContain("padding: 8px 10px;");
    expect(compactCss).toContain(".navbar-tabs {\n    display: none;");
    expect(css).not.toContain(".navbar-inner,\n  .section.detail-page-section");
  });

  it("routes plain search-form submits to the search page", () => {
    navigateMock.mockReset();

    render(<Header />);

    const input = screen.getByPlaceholderText("Search skills and plugins");
    fireEvent.change(input, { target: { value: "weather" } });
    fireEvent.submit(screen.getByRole("search", { name: "Site search" }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/search",
      search: { q: "weather", type: undefined },
    });
  });

  it("opens the empty typeahead state from the global search shortcut", () => {
    render(<Header />);

    const input = screen.getByPlaceholderText("Search skills and plugins");
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("tablist", { name: "Result type" })).toBeNull();
    expect(screen.getByText("Start typing to search skills and plugins")).toBeTruthy();
    expect(useUnifiedSearchMock).toHaveBeenLastCalledWith(
      "",
      "all",
      expect.objectContaining({ enabled: false }),
    );
  });

  it("preserves caret navigation and moves through the unified results with vertical arrows", () => {
    render(<Header />);

    const input = screen.getByPlaceholderText("Search skills and plugins");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "weather plugin" } });

    expect(fireEvent.keyDown(input, { key: "ArrowLeft" })).toBe(true);
    const firstActiveId = input.getAttribute("aria-activedescendant");
    const initialScrollCount = scrollIntoViewMock.mock.calls.length;
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).not.toBe(firstActiveId);
    expect(scrollIntoViewMock.mock.calls.length).toBeGreaterThan(initialScrollCount);
    expect(scrollIntoViewMock).toHaveBeenLastCalledWith({ block: "nearest" });
  });

  it("shows skills and plugins together in grouped typeahead sections", () => {
    navigateMock.mockReset();

    render(<Header />);

    const input = screen.getByPlaceholderText("Search skills and plugins");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "weather" } });

    const typeahead = screen.getByRole("listbox");
    const skillGroup = within(typeahead).getByRole("group", { name: "Skills" });
    const pluginGroup = within(typeahead).getByRole("group", { name: "Plugins" });
    expect(screen.getByText("Weather Skill")).toBeTruthy();
    expect(screen.getByText("@local / weather")).toBeTruthy();
    expect(screen.getByText("Weather Plugin")).toBeTruthy();
    expect(screen.getByText("@local / weather-plugin")).toBeTruthy();
    expect(skillGroup.querySelector("svg.lucide-wrench")).not.toBeNull();
    expect(pluginGroup.querySelector("svg.lucide-message-circle")).not.toBeNull();
    expect(typeahead.querySelector("svg.lucide-package")).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Result type" })).toBeNull();
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const activeDescendant = input.getAttribute("aria-activedescendant");
    expect(activeDescendant).toBeTruthy();
    expect(document.getElementById(activeDescendant ?? "")).toBeTruthy();
    expect(within(typeahead).queryByText("Publishers")).toBeNull();
    expect(within(typeahead).queryByText('See user results for "weather"')).toBeNull();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/search",
      search: { q: "weather", type: "skills" },
    });
  });

  it("omits scoped package prefixes from plugin typeahead metadata", () => {
    useUnifiedSearchMock.mockReturnValue({
      ...defaultUnifiedSearchResult,
      pluginResults: [
        {
          ...defaultUnifiedSearchResult.pluginResults[0],
          plugin: {
            ...defaultUnifiedSearchResult.pluginResults[0].plugin,
            name: "@openclaw/firecrawl-plugin",
            displayName: "OpenClaw Firecrawl Plugin",
            ownerHandle: "openclaw",
          },
        },
      ],
    });

    render(<Header />);

    const input = screen.getByPlaceholderText("Search skills and plugins");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "firecrawl" } });

    expect(screen.getByText("OpenClaw Firecrawl Plugin")).toBeTruthy();
    expect(screen.getByText("@openclaw / firecrawl-plugin")).toBeTruthy();
    expect(screen.queryByText("@openclaw / @openclaw/firecrawl-plugin")).toBeNull();
  });

  it("falls back to typed skill search when a typeahead skill has no owner handle", () => {
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
    useUnifiedSearchMock.mockReturnValue({
      results: [],
      skillResults: [],
      pluginResults: [],
      skillCount: 0,
      pluginCount: 0,
      skillHasMore: false,
      pluginHasMore: false,
      isSearching: false,
    });

    render(<Header />);

    const input = screen.getByPlaceholderText("Search skills and plugins");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "zzzz" } });

    expect(screen.getByText('No skills or plugins found for "zzzz"')).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Result type" })).toBeNull();
    expect(screen.queryByText('See skill results for "zzzz"')).toBeNull();
    expect(screen.queryByText('See plugin results for "zzzz"')).toBeNull();
  });

  it("shows Home above Skills in the mobile menu", () => {
    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    expect(
      document.querySelector('.mobile-nav-brand-mark-image[src="/logo-transparent.png"]'),
    ).toBeTruthy();

    const labels = Array.from(document.querySelectorAll(".mobile-nav-section .mobile-nav-link"))
      .map((element) => element.textContent?.trim())
      .filter((label): label is string => Boolean(label));

    expect(labels.slice(0, 5)).toEqual(["Home", "Skills", "Plugins", "Creators", "Docs"]);
    expect(
      document.querySelector(".mobile-nav-appearance-section .navbar-theme-switcher"),
    ).toBeTruthy();
  });

  it("links profile and starred skills from the signed-in avatar menu", () => {
    profileHandleMock.mockReturnValue("patrick-profile");
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

    const profile = screen.getByText("Profile");
    const dashboard = screen.getAllByText("Dashboard").at(-1)!;

    expect(profile.closest("a")?.getAttribute("href")).toBe("/patrick-profile");
    expect(profile.compareDocumentPosition(dashboard) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText("Stars").closest("a")?.getAttribute("href")).toBe("/stars");
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
    expect(screen.getByText("Settings")).toBeTruthy();
  });
});
