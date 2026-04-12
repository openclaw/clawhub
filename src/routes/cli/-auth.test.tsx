/* @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createTokenMock = vi.fn();
const clearAuthErrorMock = vi.fn();
let mockSearch: {
  redirect_uri?: string;
  label?: string;
  label_b64?: string;
  state?: string;
} = {};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: unknown }) => ({
    ...config,
    useSearch: () => mockSearch,
  }),
}));

vi.mock("convex/react", () => ({
  useMutation: () => createTokenMock,
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    tokens: {
      create: "tokens.create",
    },
  },
}));

vi.mock("../../lib/useAuthStatus", () => ({
  useAuthStatus: () => ({
    isAuthenticated: true,
    isLoading: false,
    me: { _id: "user_123" },
  }),
}));

vi.mock("../../lib/useAuthError", () => ({
  useAuthError: () => ({
    error: null,
    clear: clearAuthErrorMock,
  }),
}));

vi.mock("../../lib/site", () => ({
  getClawHubSiteUrl: () => "https://clawhub.ai",
  normalizeClawHubSiteOrigin: () => "https://clawhub.ai",
}));

vi.mock("../../components/layout/Container", () => ({
  Container: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../components/SignInButton", () => ({
  SignInButton: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock("../../components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));

const { CliAuth } = await import("./auth");

describe("CliAuth", () => {
  const assignSpy = vi.fn();

  beforeEach(() => {
    createTokenMock.mockReset();
    clearAuthErrorMock.mockReset();
    assignSpy.mockReset();
    mockSearch = {
      redirect_uri: "http://127.0.0.1:43110/callback",
      state: "state_123",
      label: "CLI token",
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the fallback token and retry link before attempting redirect", async () => {
    createTokenMock.mockResolvedValue({ token: "clh_test_token" });

    render(<CliAuth navigate={assignSpy} />);

    await waitFor(() => {
      expect(createTokenMock).toHaveBeenCalledWith({ label: "CLI token" });
    });

    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith(
        "http://127.0.0.1:43110/callback#token=clh_test_token&registry=https%3A%2F%2Fclawhub.ai&state=state_123",
      );
    });

    expect(screen.getByText(/copy this token and run/i)).toBeTruthy();
    expect(screen.getByText("clh_test_token")).toBeTruthy();
    expect(screen.getByText(/Redirecting to CLI/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Retry redirect to CLI/i }).getAttribute("href")).toBe(
      "http://127.0.0.1:43110/callback#token=clh_test_token&registry=https%3A%2F%2Fclawhub.ai&state=state_123",
    );
  });
});
