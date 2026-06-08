/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { Star } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInPrompt } from "./SignInPrompt";

const signInMock = vi.fn();
const clearAuthErrorMock = vi.fn();
const setAuthErrorMock = vi.fn();
const isBannedAccountAuthErrorMock = vi.fn();
const routeToBannedAccountPageMock = vi.fn();
let authErrorMock: string | null = null;

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({
    signIn: signInMock,
  }),
}));

vi.mock("../lib/useAuthError", () => ({
  clearAuthError: () => clearAuthErrorMock(),
  setAuthError: (message: string) => setAuthErrorMock(message),
  useAuthError: () => ({ error: authErrorMock, clear: clearAuthErrorMock }),
}));

vi.mock("../lib/authErrorMessage", () => ({
  ACCOUNT_APPEAL_LINK_TEXT: "appeal this decision",
  ACCOUNT_APPEAL_URL: "https://appeals.openclaw.ai/",
  CLAWHUB_ACCOUNT_ISSUE_LINK_TEXT: "open a GitHub issue",
  CLAWHUB_ACCOUNT_ISSUE_URL: "https://github.com/openclaw/clawhub/issues/new",
  getUserFacingAuthError: (_error: unknown, fallback: string) => fallback,
  isBannedAccountAuthError: (message: string | null | undefined) =>
    isBannedAccountAuthErrorMock(message),
  routeToBannedAccountPage: () => routeToBannedAccountPageMock(),
}));

describe("SignInPrompt", () => {
  beforeEach(() => {
    authErrorMock = null;
    clearAuthErrorMock.mockReset();
    setAuthErrorMock.mockReset();
    isBannedAccountAuthErrorMock.mockReset();
    routeToBannedAccountPageMock.mockReset();
    signInMock.mockReset();
    isBannedAccountAuthErrorMock.mockReturnValue(false);
  });

  it("renders title and description", () => {
    render(<SignInPrompt title="Sign in to test" description="Test description" />);
    expect(screen.getByRole("heading", { name: "Sign in to test" })).toBeTruthy();
    expect(screen.getByText("Test description")).toBeTruthy();
  });

  it("renders default SignInButton when no action is provided", () => {
    render(<SignInPrompt title="Sign in" />);
    expect(screen.getByRole("button", { name: /sign in with github/i })).toBeTruthy();
  });

  it("renders custom action when provided", () => {
    render(<SignInPrompt title="Sign in" action={<button type="button">Custom action</button>} />);
    expect(screen.getByRole("button", { name: "Custom action" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /sign in with github/i })).toBeNull();
  });

  it("can hide the action while auth state is loading", () => {
    render(<SignInPrompt title="Loading..." showAction={false} />);
    expect(screen.queryByRole("button", { name: /sign in with github/i })).toBeNull();
  });

  it("renders error with dismiss button when error and onDismissError are provided", () => {
    const onDismissError = vi.fn();
    render(<SignInPrompt title="Sign in" error="Auth failed" onDismissError={onDismissError} />);
    expect(screen.getByRole("alert").textContent).toContain("Auth failed");
    const dismissBtn = screen.getByRole("button", { name: "Dismiss" });
    fireEvent.click(dismissBtn);
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it("routes explicit banned-account auth errors to the banned account page", () => {
    isBannedAccountAuthErrorMock.mockReturnValue(true);
    render(
      <SignInPrompt
        title="Sign in"
        error="This ClawHub account is not in good standing and cannot sign in. Please appeal this decision if you believe this is a mistake."
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(routeToBannedAccountPageMock).toHaveBeenCalledTimes(1);
  });

  it("routes global banned-account auth errors to the banned account page", () => {
    authErrorMock =
      "This ClawHub account is not in good standing and cannot sign in. Please appeal this decision if you believe this is a mistake.";
    isBannedAccountAuthErrorMock.mockReturnValue(true);

    render(<SignInPrompt title="Sign in" />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(clearAuthErrorMock).toHaveBeenCalledTimes(1);
    expect(routeToBannedAccountPageMock).toHaveBeenCalledTimes(1);
  });

  it("does not render dismiss button when onDismissError is missing", () => {
    render(<SignInPrompt title="Sign in" error="Auth failed" />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("uses custom icon when provided", () => {
    render(<SignInPrompt title="Sign in" icon={Star} />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
  });

  it("applies custom className", () => {
    const { container } = render(<SignInPrompt title="Sign in" className="my-custom-class" />);
    expect(container.querySelector("main")?.classList.contains("my-custom-class")).toBe(true);
  });

  it("renders without description when omitted", () => {
    render(<SignInPrompt title="Sign in" />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByText(/description/i)).toBeNull();
  });
});
