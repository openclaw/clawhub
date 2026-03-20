import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useRef } from "react";
import { convex } from "../convex/client";
import { getUserFacingConvexError } from "../lib/convexError";
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
        setAuthError(getUserFacingConvexError(error, "Sign in failed. Please try again."));
      });
  }, [signInWithCode]);

  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ConvexAuthProvider client={convex} shouldHandleCode={false}>
      <AuthCodeHandler />
      <UserBootstrap />
      {children}
    </ConvexAuthProvider>
  );
}
