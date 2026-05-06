import { useAuthToken } from "@convex-dev/auth/react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { Container } from "../../components/layout/Container";
import { SignInButton } from "../../components/SignInButton";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { buildDocsAuthCallbackUrl, normalizeDocsReturnTo } from "../../lib/docsAuth";
import { getClawHubSiteUrl, normalizeClawHubSiteOrigin } from "../../lib/site";
import { useAuthError } from "../../lib/useAuthError";
import { useAuthStatus } from "../../lib/useAuthStatus";

export const Route = createFileRoute("/docs/auth")({
  component: DocsAuth,
});

type DocsAuthProps = {
  autoSubmit?: boolean;
};

export function DocsAuth({ autoSubmit = true }: DocsAuthProps = {}) {
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const authToken = useAuthToken();
  const { error: authError, clear: clearAuthError } = useAuthError();
  const formRef = useRef<HTMLFormElement>(null);
  const submittedRef = useRef(false);
  const search = Route.useSearch() as { return_to?: string };
  const returnTo = normalizeDocsReturnTo(search.return_to);
  const callbackUrl = returnTo ? buildDocsAuthCallbackUrl(returnTo) : null;
  const signInRedirectTo = returnTo
    ? `/docs/auth?return_to=${encodeURIComponent(returnTo)}`
    : undefined;
  const registry = useMemo(() => {
    if (typeof window !== "undefined") {
      return normalizeClawHubSiteOrigin(window.location.origin) ?? getClawHubSiteUrl();
    }
    return getClawHubSiteUrl();
  }, []);

  const canReturn = Boolean(returnTo && callbackUrl);
  const ready = canReturn && isAuthenticated && me && authToken;

  useEffect(() => {
    if (!autoSubmit || !ready || submittedRef.current) return;
    submittedRef.current = true;
    formRef.current?.submit();
  }, [autoSubmit, ready]);

  if (!canReturn) {
    return (
      <AuthFrame title="Docs agent login">
        <p className="text-sm text-[color:var(--ink-soft)]">Invalid docs return URL.</p>
        <p className="text-sm text-[color:var(--ink-soft)]">
          Open Ask Molty from the OpenClaw documentation page and try again.
        </p>
      </AuthFrame>
    );
  }

  if (!isAuthenticated || !me) {
    return (
      <AuthFrame title="Verify with GitHub">
        <p className="text-sm text-[color:var(--ink-soft)]">
          Sign in to ClawHub with GitHub to unlock Ask Molty on the OpenClaw docs.
        </p>
        {authError ? (
          <p
            className="rounded-[var(--radius-sm)] border border-red-300/40 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/50 dark:text-red-300"
            role="alert"
          >
            {authError}{" "}
            <button
              type="button"
              onClick={clearAuthError}
              aria-label="Dismiss"
              className="cursor-pointer border-none bg-transparent px-0.5 text-inherit"
            >
              &times;
            </button>
          </p>
        ) : null}
        <SignInButton redirectTo={signInRedirectTo} disabled={isLoading}>
          Verify with GitHub
        </SignInButton>
      </AuthFrame>
    );
  }

  if (!authToken) {
    return (
      <AuthFrame title="Connecting docs">
        <p className="text-sm text-[color:var(--ink-soft)]">Preparing your ClawHub session.</p>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Connecting docs">
      <p className="text-sm text-[color:var(--ink-soft)]">
        Returning to the OpenClaw docs with your ClawHub login.
      </p>
      <form ref={formRef} method="post" action={callbackUrl ?? undefined}>
        <input type="hidden" name="token" value={authToken} />
        <input type="hidden" name="return_to" value={returnTo ?? ""} />
        <input type="hidden" name="registry" value={registry} />
        <Button type="submit" variant="primary">
          Continue to docs
        </Button>
      </form>
    </AuthFrame>
  );
}

function AuthFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="py-10">
      <Container size="narrow">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{title}</CardTitle>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </Container>
    </main>
  );
}
