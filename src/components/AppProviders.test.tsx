/* @vitest-environment jsdom */
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthErrorSnapshot, clearAuthError } from "../lib/useAuthError";
import { AuthErrorHandler } from "./AppProviders";

vi.mock("@convex-dev/auth/react", () => ({
  ConvexAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../convex/client", () => ({
  convex: {},
}));

vi.mock("./UserBootstrap", () => ({
  UserBootstrap: () => null,
}));

describe("AuthErrorHandler", () => {
  beforeEach(() => {
    clearAuthError();
    window.history.replaceState(null, "", "/sign-in");
  });

  afterEach(() => {
    clearAuthError();
  });

  it("does nothing when there is no auth error in the URL", () => {
    render(<AuthErrorHandler />);

    expect(getAuthErrorSnapshot()).toBeNull();
  });

  it("surfaces provider errors from the URL and strips them", async () => {
    window.history.replaceState(
      null,
      "",
      "/sign-in?error=access_denied&error_description=Account%20banned&next=%2Fdashboard#section",
    );

    render(<AuthErrorHandler />);

    await waitFor(() => {
      expect(getAuthErrorSnapshot()).toBe("Account banned");
    });

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/sign-in?next=%2Fdashboard#section",
    );
  });

  it("falls back to the provider error when there is no description", async () => {
    window.history.replaceState(null, "", "/sign-in?error=access_denied");

    render(<AuthErrorHandler />);

    await waitFor(() => {
      expect(getAuthErrorSnapshot()).toBe("access_denied");
    });
  });

  it("falls back to the provider error when the description is blank", async () => {
    window.history.replaceState(
      null,
      "",
      "/sign-in?error=access_denied&error_description=%20%20%20",
    );

    render(<AuthErrorHandler />);

    await waitFor(() => {
      expect(getAuthErrorSnapshot()).toBe("access_denied");
    });

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/sign-in",
    );
  });
});
