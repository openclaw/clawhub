import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useEffect, useRef } from "react";
import { convex } from "../convex/client";
import {
  AUTH_CODE_NO_SESSION_MESSAGE,
  getUserFacingAuthError,
  normalizeAuthErrorMessage,
} from "../lib/authErrorMessage";
import { clearAuthRedirectAttempt, getActiveAuthRedirectAttempt } from "../lib/authRedirectAttempt";
import { clearAuthError, setAuthError } from "../lib/useAuthError";
import { ClientOnly } from "./ClientOnly";
import { DevPersonaFab } from "./DevPersonaFab";
import { TooltipProvider } from "./ui/tooltip";
import { UserBootstrap } from "./UserBootstrap";

function getPendingAuthCode() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return null;
  if (url.pathname === "/cli/device") {
    const pending = getActiveAuthRedirectAttempt();
    if (!pending?.redirectTo.startsWith("/cli/device?user_code=")) return null;
  }
  url.searchParams.delete("code");
  return {
    code,
    relativeUrl: `${url.pathname}${url.search}${url.hash}`,
  };
}

export function AuthCodeHandler() {
  const { signIn } = useAuthActions();
  const handledCodeRef = useRef<string | null>(null);
  const signInWithCode = signIn as (
    provider: string | undefined,
    params: { code: string },
  ) => Promise<{ signingIn: boolean }>;

  useEffect(() => {
    const pending = getPendingAuthCode();
    if (!pending) return;
    if (handledCodeRef.current === pending.code) return;
    handledCodeRef.current = pending.code;

    clearAuthRedirectAttempt();
    clearAuthError();
    window.history.replaceState(null, "", pending.relativeUrl);

    void signInWithCode(undefined, { code: pending.code })
      .then((result) => {
        if (result.signingIn === false) {
          setAuthError(AUTH_CODE_NO_SESSION_MESSAGE);
        }
      })
      .catch((error) => {
        setAuthError(getUserFacingAuthError(error, "Sign in failed. Please try again."));
      });
  }, [signInWithCode]);

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

    clearAuthRedirectAttempt();
    window.history.replaceState(null, "", pending.relativeUrl);
    setAuthError(
      normalizeAuthErrorMessage(pending.description, "Sign in failed. Please try again."),
    );
  }, []);

  return null;
}

export const AUTH_REDIRECT_NO_CODE_MESSAGE =
  "GitHub sign-in returned to ClawHub without an auth code or error. The OAuth callback likely failed before creating a session. Check the Convex auth logs and GitHub OAuth environment configuration.";

export function AuthRedirectFallbackHandler() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current || isLoading) return;
    const pending = getActiveAuthRedirectAttempt();
    if (!pending) return;

    if (isAuthenticated) {
      clearAuthRedirectAttempt();
      handledRef.current = true;
      return;
    }

    const url = new URL(window.location.href);
    const hasOAuthCode = url.pathname !== "/cli/device" && url.searchParams.has("code");
    if (hasOAuthCode || url.searchParams.has("error")) return;

    const current = `${url.pathname}${url.search}${url.hash}`;
    if (current !== pending.redirectTo) return;

    clearAuthRedirectAttempt();
    handledRef.current = true;
    setAuthError(AUTH_REDIRECT_NO_CODE_MESSAGE);
  }, [isAuthenticated, isLoading]);

  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ConvexAuthProvider client={convex} shouldHandleCode={false}>
      <TooltipProvider delayDuration={400}>
        <AuthCodeHandler />
        <AuthErrorHandler />
        <AuthRedirectFallbackHandler />
        <UserBootstrap />
        {children}
        <ClientOnly>
          <DevPersonaFab />
        </ClientOnly>
      </TooltipProvider>
    </ConvexAuthProvider>
  );
}
