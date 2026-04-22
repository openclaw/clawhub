/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import Header from "../components/Header";

const siteModeMock = vi.fn(() => "souls");
const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: (props: {
    children: ReactNode;
    className?: string;
    hash?: string;
    to?: string;
  }) => (
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

const authStatusMock = vi.fn(() => ({
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

vi.mock("../components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../components/ui/toggle-group", () => ({
  ToggleGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ToggleGroupItem: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

describe("Header", () => {
  it("hides Packages navigation in soul mode on mobile and desktop", () => {
    siteModeMock.mockReturnValue("souls");

    render(<Header />);

    expect(screen.queryByText("Packages")).toBeNull();
  });

  it("renders direct desktop theme family controls and plain Skills tab", () => {
    siteModeMock.mockReturnValue("skills");
    setThemeMock.mockClear();
    setModeMock.mockClear();

    render(<Header />);

    expect(screen.getByRole("button", { name: /Cycle theme mode/i })).toBeTruthy();
    expect(screen.getAllByText("Skills")).toHaveLength(1);
    expect(screen.getAllByText("Users")).toHaveLength(1);
    expect(screen.getByPlaceholderText("Search skills, plugins, users")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Cycle theme mode/i }));
    expect(setModeMock).toHaveBeenCalledWith("light");

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    expect(screen.getAllByText("Home")).toHaveLength(1);
    expect(screen.getAllByText("Skills")).toHaveLength(2);
    expect(screen.getAllByText("Users")).toHaveLength(2);
  });

  it("shows Home above Skills in the mobile menu", () => {
    siteModeMock.mockReturnValue("skills");

    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    expect(document.querySelector(".mobile-nav-brand-mark-image")).toBeTruthy();

    const labels = Array.from(
      document.querySelectorAll(".mobile-nav-section .mobile-nav-link"),
    )
      .map((element) => element.textContent?.trim())
      .filter((label): label is string => Boolean(label));

    expect(labels.slice(0, 2)).toEqual(["Home", "Skills"]);
    expect(screen.getAllByText("Skills")).toHaveLength(2);
    expect(screen.getAllByText("Users")).toHaveLength(2);
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
