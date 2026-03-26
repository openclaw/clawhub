/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Header from "../components/Header";

const { applyThemeMock, setModeMock, startThemeTransitionMock } = vi.hoisted(() => ({
  applyThemeMock: vi.fn(),
  setModeMock: vi.fn(),
  startThemeTransitionMock: vi.fn(
    ({ setTheme, nextTheme }: { setTheme: (value: string) => void; nextTheme: string }) =>
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

vi.mock("../components/ui/toggle-group", async () => {
  const React = await import("react");

  type ToggleGroupProps = {
    children: ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
    "aria-label"?: string;
  };

  type ToggleGroupItemProps = {
    children: ReactNode;
    value: string;
    onClick?: () => void;
    "aria-label"?: string;
    currentValue?: string;
    onValueChange?: (value: string) => void;
  };

  const values = ["system", "light", "dark"] as const;

  return {
    ToggleGroup: ({ children, value, onValueChange, ...props }: ToggleGroupProps) => (
      <div role="group" {...props}>
        {React.Children.map(children, (child) =>
          React.isValidElement<ToggleGroupItemProps>(child)
            ? React.cloneElement(child, { currentValue: value, onValueChange })
            : child,
        )}
      </div>
    ),
    ToggleGroupItem: ({
      children,
      value,
      onClick,
      currentValue,
      onValueChange,
      ...props
    }: ToggleGroupItemProps) => (
      <button
        type="button"
        role="radio"
        data-state={currentValue === value ? "on" : "off"}
        aria-checked={currentValue === value}
        onClick={onClick}
        onKeyDown={(event) => {
          if (!onValueChange || !currentValue) return;
          const currentIndex = values.indexOf(currentValue as (typeof values)[number]);
          if (event.key === "ArrowRight" && currentIndex >= 0 && currentIndex < values.length - 1) {
            onValueChange(values[currentIndex + 1]);
          }
          if (event.key === "ArrowLeft" && currentIndex > 0) {
            onValueChange(values[currentIndex - 1]);
          }
        }}
        {...props}
      >
        {children}
      </button>
    ),
  };
});

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

  it("switches theme from the desktop theme buttons", () => {
    render(<Header />);

    fireEvent.click(screen.getByRole("radio", { name: "Dark theme" }));

    expect(startThemeTransitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentTheme: "system",
        nextTheme: "dark",
      }),
    );
    expect(applyThemeMock).toHaveBeenCalledWith("dark");
    expect(setModeMock).toHaveBeenCalledWith("dark");
  });

  it("switches theme from keyboard navigation on the desktop toggle", () => {
    render(<Header />);

    const systemTheme = screen.getByRole("radio", { name: "System theme" });
    systemTheme.focus();
    fireEvent.keyDown(systemTheme, { key: "ArrowRight" });

    return waitFor(() => {
      expect(startThemeTransitionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          currentTheme: "system",
          nextTheme: "light",
        }),
      );
      expect(applyThemeMock).toHaveBeenCalledWith("light");
      expect(setModeMock).toHaveBeenCalledWith("light");
    });
  });
});
