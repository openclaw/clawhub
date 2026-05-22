/* @vitest-environment jsdom */
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_DENIED_SIGN_IN_MESSAGE,
  AUTH_CODE_NO_SESSION_MESSAGE,
  BANNED_SIGN_IN_MESSAGE,
  DELETED_SIGN_IN_MESSAGE,
} from "../lib/authErrorMessage";
import { markAuthRedirectAttempt } from "../lib/authRedirectAttempt";
import { getAuthErrorSnapshot, clearAuthError } from "../lib/useAuthError";
import {
  AUTH_REDIRECT_NO_CODE_MESSAGE,
  AuthCodeHandler,
  AuthErrorHandler,
  AuthRedirectFallbackHandler,
} from "./AppProviders";

const signInMock = vi.fn();
const useConvexAuthMock = vi.fn();

vi.mock("@convex-dev/auth/react", () => ({
  ConvexAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuthActions: () => ({
    signIn: signInMock,
  }),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => useConvexAuthMock(),
}));

vi.mock("../convex/client", () => ({
  convex: {},
}));

vi.mock("./UserBootstrap", () => ({
  UserBootstrap: () => null,
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
      expect(getAuthErrorSnapshot()).toBe(BANNED_SIGN_IN_MESSAGE);
    });
  });

  it("warns about blocked accounts when sign-in finishes without a session", async () => {
    signInMock.mockResolvedValue({ signingIn: false });
    window.history.replaceState(null, "", "/sign-in?code=abc123");

    render(<AuthCodeHandler />);

    await waitFor(() => {
      expect(getAuthErrorSnapshot()).toBe(AUTH_CODE_NO_SESSION_MESSAGE);
    });
  });

  it("surfaces deleted-account errors from code verification", async () => {
    signInMock.mockRejectedValue(
      new Error(
        "[CONVEX A] Server Error Called by client ConvexError: This account has been permanently deleted and cannot be restored.",
      ),
    );
    window.history.replaceState(null, "", "/sign-in?code=abc123");

    render(<AuthCodeHandler />);

    await waitFor(() => {
      expect(getAuthErrorSnapshot()).toBe(DELETED_SIGN_IN_MESSAGE);
    });
  });

  it("does not consume initial CLI device codes as OAuth callback codes", async () => {
    window.history.replaceState(null, "", "/cli/device?code=A8H8-GCLX");

    render(<AuthCodeHandler />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(signInMock).not.toHaveBeenCalled();
    expect(getAuthErrorSnapshot()).toBeNull();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/cli/device?code=A8H8-GCLX",
    );
  });

  it("consumes OAuth callback codes on CLI device redirects while preserving the user code", async () => {
    signInMock.mockResolvedValue({ signingIn: true });
    markAuthRedirectAttempt("github", "/cli/device?user_code=A8H8-GCLX");
    window.history.replaceState(null, "", "/cli/device?user_code=A8H8-GCLX&code=oauth123");

    render(<AuthCodeHandler />);

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith(undefined, { code: "oauth123" });
    });
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/cli/device?user_code=A8H8-GCLX",
    );
  });
});

describe("AuthErrorHandler", () => {
  beforeEach(() => {
    signInMock.mockReset();
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
      expect(getAuthErrorSnapshot()).toBe(BANNED_SIGN_IN_MESSAGE);
    });

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/sign-in?next=%2Fdashboard#section",
    );
  });

  it("falls back to the provider error when there is no description", async () => {
    window.history.replaceState(null, "", "/sign-in?error=access_denied");

    render(<AuthErrorHandler />);

    await waitFor(() => {
      expect(getAuthErrorSnapshot()).toBe(ACCESS_DENIED_SIGN_IN_MESSAGE);
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
      expect(getAuthErrorSnapshot()).toBe(ACCESS_DENIED_SIGN_IN_MESSAGE);
    });

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/sign-in",
    );
  });
});

describe("AuthRedirectFallbackHandler", () => {
  beforeEach(() => {
    clearAuthError();
    window.sessionStorage.clear();
    window.history.replaceState(
      null,
      "",
      "/cli/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A43110%2Fcallback&state=state_123",
    );
    useConvexAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: false });
  });

  afterEach(() => {
    clearAuthError();
    window.sessionStorage.clear();
  });

  it("surfaces callback failures that return without code, error, or session", async () => {
    markAuthRedirectAttempt(
      "github",
      "/cli/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A43110%2Fcallback&state=state_123",
    );

    render(<AuthRedirectFallbackHandler />);

    await waitFor(() => {
      expect(getAuthErrorSnapshot()).toBe(AUTH_REDIRECT_NO_CODE_MESSAGE);
    });
  });

  it("preserves provider errors while an OAuth error callback is being processed", async () => {
    markAuthRedirectAttempt(
      "github",
      "/cli/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A43110%2Fcallback&state=state_123",
    );
    window.history.replaceState(
      null,
      "",
      "/cli/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A43110%2Fcallback&state=state_123&error=access_denied",
    );

    render(
      <>
        <AuthErrorHandler />
        <AuthRedirectFallbackHandler />
      </>,
    );

    await waitFor(() => {
      expect(getAuthErrorSnapshot()).toBe(ACCESS_DENIED_SIGN_IN_MESSAGE);
    });
  });

  it("reports missing OAuth callback failures on CLI device pages without consuming the device code", async () => {
    markAuthRedirectAttempt("github", "/cli/device?user_code=A8H8-GCLX");
    window.history.replaceState(null, "", "/cli/device?user_code=A8H8-GCLX");

    render(<AuthRedirectFallbackHandler />);

    await waitFor(() => {
      expect(getAuthErrorSnapshot()).toBe(AUTH_REDIRECT_NO_CODE_MESSAGE);
    });
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/cli/device?user_code=A8H8-GCLX",
    );
  });

  it("does not report a missing-code failure while an auth code is being processed", async () => {
    signInMock.mockReturnValue(new Promise(() => undefined));
    markAuthRedirectAttempt(
      "github",
      "/cli/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A43110%2Fcallback&state=state_123",
    );
    window.history.replaceState(
      null,
      "",
      "/cli/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A43110%2Fcallback&state=state_123&code=abc123",
    );

    render(
      <>
        <AuthCodeHandler />
        <AuthRedirectFallbackHandler />
      </>,
    );

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith(undefined, { code: "abc123" });
    });
    expect(getAuthErrorSnapshot()).toBeNull();
  });

  it("clears the pending redirect marker after a successful session", () => {
    useConvexAuthMock.mockReturnValue({ isAuthenticated: true, isLoading: false });
    markAuthRedirectAttempt(
      "github",
      "/cli/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A43110%2Fcallback&state=state_123",
    );

    render(<AuthRedirectFallbackHandler />);

    expect(getAuthErrorSnapshot()).toBeNull();
  });
});
