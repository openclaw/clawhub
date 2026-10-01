import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { convex } from "../convex/client";
import {
  AUTH_CODE_NO_SESSION_MESSAGE,
  getUserFacingAuthError,
  isBannedAccountAuthError,
  normalizeAuthErrorMessage,
  routeToBannedAccountPage as navigateToBannedAccountPage,
} from "../lib/authErrorMessage";
import { isCliDeviceUserCode } from "../lib/cliDeviceCode";
import { clearAuthError, setAuthError, useAuthError } from "../lib/useAuthError";
import { AuthErrorMessage } from "./AuthErrorMessage";
import { ClientOnly } from "./ClientOnly";
import { DevPersonaFab } from "./DevPersonaFab";
import { TooltipProvider } from "./ui/tooltip";
import { UserBootstrap } from "./UserBootstrap";

function getPendingAuthCode() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return null;
  // Preserve legacy CLI device links; this code is not an OAuth completion.
  if (isCliDeviceUserCode(code)) return null;
  const isRetry = url.searchParams.get("auth_retry") === "1";
  const retryUrl = new URL(window.location.href);
  retryUrl.searchParams.delete("code");
  retryUrl.searchParams.set("auth_retry", "1");
  url.searchParams.delete("code");
  url.searchParams.delete("auth_retry");
  return {
    code,
    isRetry,
    relativeUrl: `${url.pathname}${url.search}${url.hash}`,
    retryRelativeUrl: `${retryUrl.pathname}${retryUrl.search}${retryUrl.hash}`,
  };
}

function routeAuthErrorToBannedAccountPage() {
  if (typeof window === "undefined") return;
  clearAuthError();
  navigateToBannedAccountPage();
}

function handleAuthErrorMessage(message: string) {
  if (isBannedAccountAuthError(message)) {
    routeAuthErrorToBannedAccountPage();
    return;
  }
  setAuthError(message);
}

export function AuthCodeHandler() {
  const { signIn } = useAuthActions();
  const handledCodeRef = useRef<string | null>(null);
  const signInWithGitHub = signIn as (
    provider: string | undefined,
    params: { code: string } | { redirectTo: string },
  ) => Promise<{ signingIn: boolean; redirect?: URL }>;

  useEffect(() => {
    const pending = getPendingAuthCode();
    if (!pending) return;
    if (handledCodeRef.current === pending.code) return;
    handledCodeRef.current = pending.code;

    clearAuthError();
    window.history.replaceState(
      null,
      "",
      pending.isRetry ? pending.relativeUrl : pending.retryRelativeUrl,
    );

    void signInWithGitHub(undefined, { code: pending.code })
      .then((result) => {
        if (result.signingIn !== false) {
          window.history.replaceState(null, "", pending.relativeUrl);
          return;
        }

        console.log("[ClawHub auth] GitHub code sign-in did not create a session", {
          path: window.location.pathname,
          retrying: !pending.isRetry,
          hadRetryMarker: pending.isRetry,
          hasReturnTo: new URL(window.location.href).searchParams.has("return_to"),
        });

        if (!pending.isRetry) {
          window.history.replaceState(null, "", pending.retryRelativeUrl);
          void signInWithGitHub("github", { redirectTo: pending.retryRelativeUrl })
            .then((retryResult) => {
              if (retryResult?.signingIn === false && !retryResult.redirect) {
                window.history.replaceState(null, "", pending.relativeUrl);
                setAuthError(AUTH_CODE_NO_SESSION_MESSAGE);
              }
            })
            .catch((error) => {
              const message = getUserFacingAuthError(error, "Sign in failed. Please try again.");
              if (isBannedAccountAuthError(message)) {
                routeAuthErrorToBannedAccountPage();
                return;
              }
              window.history.replaceState(null, "", pending.relativeUrl);
              setAuthError(message);
            });
          return;
        }

        window.history.replaceState(null, "", pending.relativeUrl);
        setAuthError(AUTH_CODE_NO_SESSION_MESSAGE);
      })
      .catch((error) => {
        const message = getUserFacingAuthError(error, "Sign in failed. Please try again.");
        if (isBannedAccountAuthError(message)) {
          routeAuthErrorToBannedAccountPage();
          return;
        }
        window.history.replaceState(null, "", pending.relativeUrl);
        setAuthError(message);
      });
  }, [signInWithGitHub]);

  return null;
}

function getPendingAuthError() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const description =
    url.searchParams.get("error_description")?.trim() || url.searchParams.get("error")?.trim();
  if (!description) return null;
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  return {
    description,
    relativeUrl: `${url.pathname}${url.search}${url.hash}`,
  };
}

export function AuthErrorHandler() {
  const handledErrorRef = useRef<string | null>(null);
  useEffect(() => {
    const pending = getPendingAuthError();
    if (!pending) return;
    if (handledErrorRef.current === pending.description) return;
    handledErrorRef.current = pending.description;

    const message = normalizeAuthErrorMessage(
      pending.description,
      "Sign in failed. Please try again.",
    );
    if (isBannedAccountAuthError(message)) {
      routeAuthErrorToBannedAccountPage();
      return;
    }
    window.history.replaceState(null, "", pending.relativeUrl);
    handleAuthErrorMessage(message);
  }, []);

  return null;
}

export function AuthErrorToast() {
  const { error } = useAuthError();
  const lastShownRef = useRef<string | null>(null);

  useEffect(() => {
    if (!error) {
      lastShownRef.current = null;
      return;
    }
    if (lastShownRef.current === error) return;
    lastShownRef.current = error;

    toast.error(<AuthErrorMessage message={error} />, { id: "auth-error" });
  }, [error]);

  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ConvexAuthProvider client={convex} shouldHandleCode={false}>
      <TooltipProvider delayDuration={400}>
        <AuthCodeHandler />
        <AuthErrorHandler />
        <AuthErrorToast />
        <UserBootstrap />
        {children}
        <ClientOnly>
          <DevPersonaFab />
        </ClientOnly>
      </TooltipProvider>
    </ConvexAuthProvider>
  );
}
