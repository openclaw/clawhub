/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Header from "../components/Header";

let mockSiteMode: "souls" | "skills" = "souls";

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
  applyTheme: vi.fn(),
  useThemeMode: () => ({
    mode: "system",
    setMode: vi.fn(),
  }),
}));

vi.mock("../lib/theme-transition", () => ({
  startThemeTransition: ({ setTheme, nextTheme }: { setTheme: (value: string) => void; nextTheme: string }) =>
    setTheme(nextTheme),
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
  getSiteMode: () => mockSiteMode,
  getSiteName: () => (mockSiteMode === "souls" ? "OnlyCrabs" : "ClawHub"),
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

vi.mock("../components/ui/toggle-group", () => ({
  ToggleGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ToggleGroupItem: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}));

describe("Header", () => {
  beforeEach(() => {
    mockSiteMode = "souls";
  });

  it("hides Packages navigation in soul mode on mobile and desktop", () => {
    render(<Header />);

    expect(screen.queryByText("Packages")).toBeNull();
  });

  it("does not render a separate Search navigation item in skills mode", () => {
    mockSiteMode = "skills";

    render(<Header />);

    expect(screen.queryByText("Search")).toBeNull();
  });
});
