/* @vitest-environment jsdom */
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_DENIED_SIGN_IN_MESSAGE,
  AUTH_CODE_NO_SESSION_MESSAGE,
  BANNED_ACCOUNT_PATH,
  DELETED_SIGN_IN_MESSAGE,
} from "../lib/authErrorMessage";
import { getAuthErrorSnapshot, clearAuthError, setAuthError } from "../lib/useAuthError";
import { AuthCodeHandler, AuthErrorHandler, AuthErrorToast } from "./AppProviders";

const signInMock = vi.fn();
const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
}));
let consoleLogMock: ReturnType<typeof vi.spyOn>;

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

vi.mock("@convex-dev/auth/react", () => ({
  ConvexAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuthActions: () => ({
    signIn: signInMock,
  }),
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
    consoleLogMock = vi.spyOn(console, "log").mockImplementation(() => {});
    clearAuthError();
    window.history.replaceState(null, "", "/sign-in");
  });

  afterEach(() => {
    clearAuthError();
    consoleLogMock.mockRestore();
  });

  it("strips the auth code from the URL after a session is created", async () => {
    signInMock.mockResolvedValue({ signingIn: true });
    window.history.replaceState(
      null,
      "",
      "/sign-in?code=abc123&auth_retry=1&next=%2Fdashboard#section",
    );

    render(<AuthCodeHandler />);

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith(undefined, { code: "abc123" });
    });

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/sign-in?next=%2Fdashboard#section",
    );
    expect(getAuthErrorSnapshot()).toBeNull();
  });

  it("leaves CLI device user codes for the device route", async () => {
    window.history.replaceState(null, "", "/cli/device?code=ABCD-2345");

    render(<AuthCodeHandler />);

    await waitFor(() => {
      expect(signInMock).not.toHaveBeenCalled();
    });
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/cli/device?code=ABCD-2345",
    );
  });

  it("still consumes long OAuth completion codes", async () => {
    const code = "long-random-oauth-completion-code-1234567890";
    signInMock.mockResolvedValue({ signingIn: true });
    window.history.replaceState(null, "", `/sign-in?code=${code}`);

    render(<AuthCodeHandler />);

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith(undefined, { code });
    });
    expect(`${window.location.pathname}${window.location.search}`).toBe("/sign-in");
  });

  it("strips the auth code before waiting for code verification", async () => {
    signInMock.mockReturnValue(new Promise(() => {}));
    window.history.replaceState(
      null,
      "",
      "/auth/docs?code=abc123&return_to=https%3A%2F%2Fdocs.openclaw.ai%2Fask#molty",
    );

    render(<AuthCodeHandler />);

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith(undefined, { code: "abc123" });
    });
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/auth/docs?return_to=https%3A%2F%2Fdocs.openclaw.ai%2Fask&auth_retry=1#molty",
    );
  });

  it("routes banned-account errors from code verification to the account-banned page", async () => {
    signInMock.mockRejectedValue(
      new Error("[CONVEX A] Server Error Called by client ConvexError: Account banned"),
    );
    window.history.replaceState(null, "", "/sign-in?code=abc123");

    render(<AuthCodeHandler />);

    await waitFor(() => {
      expect(window.location.pathname).toBe(BANNED_ACCOUNT_PATH);
    });
    expect(getAuthErrorSnapshot()).toBeNull();
  });

  it("restarts GitHub sign-in once when code verification finishes without a session", async () => {
    signInMock.mockResolvedValueOnce({ signingIn: false }).mockResolvedValueOnce({
      signingIn: false,
      redirect: new URL("https://github.com/login/oauth/authorize"),
    });
    window.history.replaceState(
      null,
      "",
      "/auth/docs?code=abc123&return_to=https%3A%2F%2Fdocs.openclaw.ai%2Fask#molty",
    );

    render(<AuthCodeHandler />);

    await waitFor(() => {
      expect(signInMock).toHaveBeenNthCalledWith(1, undefined, { code: "abc123" });
      expect(signInMock).toHaveBeenNthCalledWith(2, "github", {
        redirectTo: "/auth/docs?return_to=https%3A%2F%2Fdocs.openclaw.ai%2Fask&auth_retry=1#molty",
      });
    });

    expect(consoleLogMock).toHaveBeenCalledWith(
      "[ClawHub auth] GitHub code sign-in did not create a session",
      {
        path: "/auth/docs",
        retrying: true,
        hadRetryMarker: false,
        hasReturnTo: true,
      },
    );
    expect(getAuthErrorSnapshot()).toBeNull();
  });

  it("shows a generic error when the retried code still finishes without a session", async () => {
    signInMock.mockResolvedValue({ signingIn: false });
    window.history.replaceState(
      null,
      "",
      "/auth/docs?code=abc123&return_to=https%3A%2F%2Fdocs.openclaw.ai%2Fask&auth_retry=1#molty",
    );

    render(<AuthCodeHandler />);

    await waitFor(() => {
      expect(getAuthErrorSnapshot()).toBe(AUTH_CODE_NO_SESSION_MESSAGE);
    });

    expect(signInMock).toHaveBeenCalledTimes(1);
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/auth/docs?return_to=https%3A%2F%2Fdocs.openclaw.ai%2Fask#molty",
    );
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

  it("routes banned-account provider errors to the account-banned page", async () => {
    window.history.replaceState(
      null,
      "",
      "/sign-in?error=access_denied&error_description=Account%20banned&next=%2Fdashboard#section",
    );

    render(<AuthErrorHandler />);

    await waitFor(() => {
      expect(window.location.pathname).toBe(BANNED_ACCOUNT_PATH);
    });
    expect(getAuthErrorSnapshot()).toBeNull();
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
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

describe("AuthErrorToast", () => {
  beforeEach(() => {
    toastErrorMock.mockReset();
    clearAuthError();
  });

  afterEach(() => {
    clearAuthError();
  });

  it("surfaces global auth errors as toasts", async () => {
    render(<AuthErrorToast />);

    act(() => {
      setAuthError("Sign in failed. Please open a GitHub issue.");
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(expect.anything(), { id: "auth-error" });
    });
  });
});
