/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DevPersonaFab } from "./DevPersonaFab";

const signInMock = vi.fn();
const signOutMock = vi.fn();
const authStatusMock = vi.fn();

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({
    signIn: signInMock,
    signOut: signOutMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../lib/runtimeEnv", () => ({
  getRuntimeEnv: (name: string) => {
    if (name === "VITE_ENABLE_DEV_AUTH") return process.env.VITE_ENABLE_DEV_AUTH;
    return undefined;
  },
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => authStatusMock(),
}));

vi.mock("./ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: (event: { preventDefault: () => void }) => void;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect?.({ preventDefault: vi.fn() })}
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function setHostname(hostname: string) {
  Object.defineProperty(window, "location", {
    value: { hostname },
    configurable: true,
  });
}

describe("DevPersonaFab", () => {
  beforeEach(() => {
    signInMock.mockReset();
    signOutMock.mockReset();
    signInMock.mockResolvedValue({ signingIn: true });
    signOutMock.mockResolvedValue(undefined);
    authStatusMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      me: null,
    });
    process.env.VITE_ENABLE_DEV_AUTH = "1";
    setHostname("localhost");
  });

  it("stays hidden unless local dev auth is enabled", () => {
    process.env.VITE_ENABLE_DEV_AUTH = "0";

    render(<DevPersonaFab />);

    expect(screen.queryByRole("button", { name: /open local dev personas/i })).toBeNull();
  });

  it("stays hidden away from localhost", () => {
    setHostname("clawhub.ai");

    render(<DevPersonaFab />);

    expect(screen.queryByRole("button", { name: /open local dev personas/i })).toBeNull();
  });

  it("signs in with the selected local persona", async () => {
    render(<DevPersonaFab />);

    fireEvent.click(screen.getByRole("button", { name: /use admin/i }));

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith("dev-persona", { persona: "admin" });
    });
  });

  it("signs out of the current local persona", async () => {
    authStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { handle: "local-admin" },
    });

    render(<DevPersonaFab />);

    expect(screen.getAllByText("@local-admin").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalled();
    });
  });
});
