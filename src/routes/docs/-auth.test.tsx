/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockSearch: { return_to?: string } = {};
let mockAuthToken: string | null = "convex.jwt";
let mockAuthStatus = {
  isAuthenticated: true,
  isLoading: false,
  me: { _id: "user_123" } as { _id: string } | null,
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: unknown }) => ({
    ...config,
    useSearch: () => mockSearch,
  }),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthToken: () => mockAuthToken,
}));

vi.mock("../../lib/useAuthStatus", () => ({
  useAuthStatus: () => mockAuthStatus,
}));

vi.mock("../../lib/useAuthError", () => ({
  useAuthError: () => ({ error: null, clear: vi.fn() }),
}));

vi.mock("../../components/layout/Container", () => ({
  Container: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../components/SignInButton", () => ({
  SignInButton: ({
    children,
    redirectTo,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { redirectTo?: string }) => (
    <button {...props} data-redirect-to={redirectTo}>
      {children}
    </button>
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

const { DocsAuth } = await import("./auth");

describe("DocsAuth", () => {
  beforeEach(() => {
    mockSearch = { return_to: "https://documentation.openclaw.ai/concepts/models" };
    mockAuthToken = "convex.jwt";
    mockAuthStatus = {
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "user_123" },
    };
  });

  it("posts the ClawHub auth token to the docs callback", () => {
    render(<DocsAuth autoSubmit={false} />);

    const form = screen.getByRole("button", { name: /continue to docs/i }).closest("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe(
      "https://documentation.openclaw.ai/ask-molty/auth/callback",
    );
    expect(document.querySelector<HTMLInputElement>('input[name="token"]')?.value).toBe(
      "convex.jwt",
    );
    expect(document.querySelector<HTMLInputElement>('input[name="return_to"]')?.value).toBe(
      "https://documentation.openclaw.ai/concepts/models",
    );
  });

  it("asks for GitHub verification when no ClawHub session exists", () => {
    mockAuthStatus = { isAuthenticated: false, isLoading: false, me: null };

    render(<DocsAuth autoSubmit={false} />);

    expect(screen.getByRole("heading", { name: /verify with github/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /verify with github/i }).dataset.redirectTo).toBe(
      "/docs/auth?return_to=https%3A%2F%2Fdocumentation.openclaw.ai%2Fconcepts%2Fmodels",
    );
  });

  it("rejects unsafe return URLs", () => {
    mockSearch = { return_to: "https://example.com/steal" };

    render(<DocsAuth autoSubmit={false} />);

    expect(screen.getByText(/invalid docs return url/i)).toBeTruthy();
  });
});
