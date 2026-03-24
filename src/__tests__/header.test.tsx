/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Header from "../components/Header";

// I hoist these mocks so they're available inside vi.mock() factories.
const { applyThemeMock, setModeMock, startThemeTransitionMock } = vi.hoisted(() => ({
  applyThemeMock: vi.fn(),
  setModeMock: vi.fn(),
  // This fake calls setTheme right away, so I can assert that
  // applyTheme and setMode got the right value downstream.
  startThemeTransitionMock: vi.fn(
    ({ setTheme, nextTheme }: { setTheme: (v: string) => void; nextTheme: string }) =>
      setTheme(nextTheme),
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => ({
    isAuthenticated: false,
    isLoading: false,
    me: null,
  }),
}));

vi.mock("../lib/theme", () => ({
  applyTheme: applyThemeMock,
  useThemeMode: () => ({
    mode: "system",
    setMode: setModeMock,
  }),
}));

vi.mock("../lib/theme-transition", () => ({
  startThemeTransition: startThemeTransitionMock,
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
  getSiteMode: () => "souls",
  getSiteName: () => "OnlyCrabs",
}));

vi.mock("../lib/convexError", () => ({
  getUserFacingConvexError: vi.fn(),
}));

vi.mock("../lib/gravatar", () => ({
  gravatarUrl: vi.fn(),
}));

vi.mock("../components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// I only need onClick to pass through here — the real Radix component
// isn't needed since I'm testing the wiring, not the UI library.
vi.mock("../components/ui/toggle-group", () => ({
  ToggleGroup: ({ children }: { children: ReactNode }) => (
    <div role="group">{children}</div>
  ),
  ToggleGroupItem: ({
    children,
    onClick,
    ...props
  }: { children: ReactNode; onClick?: () => void; "aria-label"?: string; value?: string }) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

describe("Header", () => {
  beforeEach(() => {
    applyThemeMock.mockClear();
    setModeMock.mockClear();
    startThemeTransitionMock.mockClear();
  });

  it("hides Packages navigation in soul mode on mobile and desktop", () => {
    render(<Header />);
    expect(screen.queryByText("Packages")).toBeNull();
  });

  // Make sure clicking a theme button goes through the whole chain:
  // startThemeTransition → applyTheme → setMode.
  it("switches theme when a desktop theme button is clicked", () => {
    render(<Header />);

    fireEvent.click(screen.getByLabelText("Dark theme"));

    expect(startThemeTransitionMock).toHaveBeenCalledWith(
      expect.objectContaining({ currentTheme: "system", nextTheme: "dark" }),
    );
    expect(applyThemeMock).toHaveBeenCalledWith("dark");
    expect(setModeMock).toHaveBeenCalledWith("dark");
  });
});
