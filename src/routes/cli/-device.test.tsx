/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const approveMock = vi.fn();
const denyMock = vi.fn();
let mockSearch: { code?: string } = {};
let mockAuthStatus = {
  isAuthenticated: true,
  isLoading: false,
  isDevImpersonated: false,
  me: { _id: "user_123" } as { _id: string } | null,
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: unknown }) => ({
    ...config,
    useSearch: () => mockSearch,
  }),
}));

vi.mock("convex/react", () => ({
  useMutation: (mutation: string) => {
    if (mutation === "cliDeviceAuth.approve") return approveMock;
    if (mutation === "cliDeviceAuth.deny") return denyMock;
    throw new Error(`Unexpected mutation: ${mutation}`);
  },
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    cliDeviceAuth: {
      approve: "cliDeviceAuth.approve",
      deny: "cliDeviceAuth.deny",
    },
  },
}));

vi.mock("../../lib/useAuthStatus", () => ({
  useAuthStatus: () => mockAuthStatus,
}));

vi.mock("../../components/layout/Container", () => ({
  Container: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../components/SignInButton", () => ({
  SignInButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("../../components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("../../components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));

vi.mock("../../components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("../../components/ui/label", () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

const { CliDeviceAuth } = await import("./device");

describe("CliDeviceAuth", () => {
  beforeEach(() => {
    approveMock.mockReset();
    denyMock.mockReset();
    mockSearch = { code: "ABCD-2345" };
    mockAuthStatus = {
      isAuthenticated: true,
      isLoading: false,
      isDevImpersonated: false,
      me: { _id: "user_123" },
    };
  });

  it("approves a device code for a real authenticated session", async () => {
    approveMock.mockResolvedValue({ ok: true });

    render(<CliDeviceAuth />);

    fireEvent.click(screen.getByRole("button", { name: /authorize/i }));

    await waitFor(() => {
      expect(approveMock).toHaveBeenCalledWith({ userCode: "ABCD-2345" });
    });
    expect(screen.getByText(/authorized/i)).toBeTruthy();
  });

  it("requires real GitHub auth before approving a device code", () => {
    mockAuthStatus = {
      isAuthenticated: true,
      isLoading: false,
      isDevImpersonated: true,
      me: { _id: "user_local" },
    };

    render(<CliDeviceAuth />);

    expect(screen.getByText(/sign in to authorize the cli/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /authorize/i })).toBeNull();
    expect(approveMock).not.toHaveBeenCalled();
  });
});
