/* @vitest-environment jsdom */
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthErrorSnapshot, clearAuthError } from "../lib/useAuthError";
import { AuthCodeHandler } from "./AppProviders";

const signInMock = vi.fn();

vi.mock("@convex-dev/auth/react", () => ({
  ConvexAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuthActions: () => ({
    signIn: signInMock,
  }),
}));

vi.mock("../convex/client", () => ({
  convex: {},
}));

describe("AuthCodeHandler", () => {
  beforeEach(() => {
    signInMock.mockReset();
    clearAuthError();
    window.history.replaceState(null, "", "/sign-in");
  });

  afterEach(() => {
    clearAuthError();
  });

  it("consumes the auth code and strips it from the URL", async () => {
    signInMock.mockResolvedValue({ signingIn: true });
    window.history.replaceState(null, "", "/sign-in?code=abc123&next=%2Fdashboard#section");

    render(<AuthCodeHandler />);

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith(undefined, { code: "abc123" });
    });

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/sign-in?next=%2Fdashboard#section",
    );
    expect(getAuthErrorSnapshot()).toBeNull();
  });

  it("surfaces user-facing sign-in errors from code verification", async () => {
    signInMock.mockRejectedValue(
      new Error("[CONVEX A] Server Error Called by client ConvexError: Account banned"),
    );
    window.history.replaceState(null, "", "/sign-in?code=abc123");

    render(<AuthCodeHandler />);

    await waitFor(() => {
      expect(getAuthErrorSnapshot()).toBe("Account banned");
    });
  });

  it("shows a generic error when sign-in finishes without a session", async () => {
    signInMock.mockResolvedValue({ signingIn: false });
    window.history.replaceState(null, "", "/sign-in?code=abc123");

    render(<AuthCodeHandler />);

    await waitFor(() => {
      expect(getAuthErrorSnapshot()).toBe("Sign in failed. Please try again.");
    });
  });
});
