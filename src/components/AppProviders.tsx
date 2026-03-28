import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { useEffect, useRef } from "react";
import { convex } from "../convex/client";
import { setAuthError } from "../lib/useAuthError";
import { UserBootstrap } from "./UserBootstrap";

function getPendingAuthError() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const description =
    url.searchParams.get("error_description")?.trim() ?? url.searchParams.get("error")?.trim();
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
    setAuthError(pending.description);
  }, []);

  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ConvexAuthProvider client={convex}>
      <AuthErrorHandler />
      <UserBootstrap />
      {children}
    </ConvexAuthProvider>
  );
}
