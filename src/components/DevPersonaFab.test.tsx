/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
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

vi.mock("./ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, id }: { children: ReactNode; id?: string }) => (
    <button aria-labelledby={id} type="button">
      {children}
    </button>
  ),
  SelectValue: () => <span>Auth</span>,
}));

function setHostname(hostname: string) {
  Object.defineProperty(window, "location", {
    value: { hostname },
    configurable: true,
  });
}

describe("DevPersonaFab", () => {
  beforeEach(() => {
    vi.useRealTimers();
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

  it.each([
    ["owner", /use owner/i],
    ["user", /use user/i],
    ["admin", /use admin/i],
  ] as const)("signs in with the %s local persona", async (persona, label) => {
    render(<DevPersonaFab />);

    fireEvent.click(screen.getByRole("button", { name: label }));

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith("dev-persona", { persona });
    });
  });

  it("signs out before switching between local personas", async () => {
    authStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { handle: "local" },
    });

    render(<DevPersonaFab />);

    fireEvent.click(screen.getByRole("button", { name: /use user/i }));

    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalledBefore(signInMock);
      expect(signInMock).toHaveBeenCalledWith("dev-persona", { persona: "user" });
    });
  });

  it("signs out of the current local persona", async () => {
    authStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { handle: "local-admin" },
    });

    render(<DevPersonaFab />);

    expect(screen.getByLabelText("Active persona")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalled();
    });
  });

  it("recovers when local dev auth does not respond", async () => {
    vi.useFakeTimers();
    signInMock.mockReturnValue(new Promise(() => {}));

    render(<DevPersonaFab />);

    fireEvent.click(screen.getByRole("button", { name: /use user/i }));
    expect(screen.getByRole("button", { name: /switching/i }).hasAttribute("disabled")).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Dev persona auth timed out. Check the local Convex backend.",
    );
    expect(screen.getByRole("button", { name: /use user/i }).hasAttribute("disabled")).toBe(false);
  });
});
