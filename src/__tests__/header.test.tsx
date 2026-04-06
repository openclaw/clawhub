/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import Header from "../components/Header";

const siteModeMock = vi.fn(() => "souls");
const convexQueryMock = vi.fn().mockResolvedValue(0);

vi.mock("@tanstack/react-router", () => ({
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
  useNavigate: () => vi.fn(),
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
  getSiteMode: () => siteModeMock(),
  getSiteName: () => "OnlyCrabs",
}));

vi.mock("../lib/convexError", () => ({
  getUserFacingConvexError: vi.fn(),
}));

vi.mock("../lib/gravatar", () => ({
  gravatarUrl: vi.fn(),
}));

vi.mock("../convex/client", () => ({
  convexHttp: {
    query: convexQueryMock,
  },
}));

vi.mock("../../convex/_generated/api", () => ({
  api: {
    skills: {
      countPublicSkills: "countPublicSkills",
    },
  },
}));

vi.mock("../lib/numberFormat", () => ({
  formatCompactStat: (n: number) => String(n),
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
  it("hides Packages navigation in soul mode on mobile and desktop", () => {
    siteModeMock.mockReturnValue("souls");

    render(<Header />);

    expect(screen.queryByText("Packages")).toBeNull();
  });

  it("renders a plain Skills tab without fetching a count", () => {
    siteModeMock.mockReturnValue("skills");
    convexQueryMock.mockClear();

    render(<Header />);

    expect(screen.getAllByText("Skills")).toHaveLength(2);
    expect(screen.getAllByText("Souls")).toHaveLength(2);
    expect(screen.getAllByText("Users")).toHaveLength(2);
    expect(screen.getByPlaceholderText("Search skills, plugins, users")).toBeTruthy();
    expect(convexQueryMock).not.toHaveBeenCalled();
  });
});
