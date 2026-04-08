import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useRef } from "react";
import { convex } from "../convex/client";
import { getUserFacingAuthError, normalizeAuthErrorMessage } from "../lib/authErrorMessage";
import { clearAuthError, setAuthError } from "../lib/useAuthError";
import { UserBootstrap } from "./UserBootstrap";

function getPendingAuthCode() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return null;
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

    clearAuthError();
    window.history.replaceState(null, "", pending.relativeUrl);

    void signInWithCode(undefined, { code: pending.code })
      .then((result) => {
        if (result.signingIn === false) {
          setAuthError("Sign in failed. Please try again.");
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

    window.history.replaceState(null, "", pending.relativeUrl);
    setAuthError(
      normalizeAuthErrorMessage(pending.description, "Sign in failed. Please try again."),
    );
  }, []);

  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ConvexAuthProvider client={convex} shouldHandleCode={false}>
      <AuthCodeHandler />
      <AuthErrorHandler />
      <UserBootstrap />
      {children}
    </ConvexAuthProvider>
  );
}
