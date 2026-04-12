import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api } from "../../../convex/_generated/api";
import { Container } from "../../components/layout/Container";
import { SignInButton } from "../../components/SignInButton";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { getClawHubSiteUrl, normalizeClawHubSiteOrigin } from "../../lib/site";
import { useAuthError } from "../../lib/useAuthError";
import { useAuthStatus } from "../../lib/useAuthStatus";

export const Route = createFileRoute("/cli/auth")({
  component: CliAuth,
});

type CliAuthProps = {
  navigate?: (url: string) => void;
};

export function CliAuth({ navigate = (url: string) => window.location.assign(url) }: CliAuthProps = {}) {
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const { error: authError, clear: clearAuthError } = useAuthError();
  const createToken = useMutation(api.tokens.create);

  const search = Route.useSearch() as {
    redirect_uri?: string;
    label?: string;
    label_b64?: string;
    state?: string;
  };
  const [status, setStatus] = useState<string>("Preparing...");
  const [token, setToken] = useState<string | null>(null);
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);
  const hasRun = useRef(false);

  const redirectUri = search.redirect_uri ?? "";
  const label =
    (decodeLabel(search.label_b64) ?? search.label ?? "CLI token").trim() || "CLI token";
  const state = typeof search.state === "string" ? search.state.trim() : "";

  const safeRedirect = useMemo(() => isAllowedRedirectUri(redirectUri), [redirectUri]);
  const registry = useMemo(() => {
    if (typeof window !== "undefined") {
      return normalizeClawHubSiteOrigin(window.location.origin) ?? getClawHubSiteUrl();
    }
    return getClawHubSiteUrl();
  }, []);

  useEffect(() => {
    if (hasRun.current) return;
    if (!safeRedirect) return;
    if (!state) return;
    if (!isAuthenticated || !me) return;
    hasRun.current = true;

    const run = async () => {
      setStatus("Creating token...");
      const result = await createToken({ label });
      const hash = new URLSearchParams();
      hash.set("token", result.token);
      hash.set("registry", registry);
      hash.set("state", state);
      const redirectUrl = `${redirectUri}#${hash.toString()}`;
      // Render the fallback token before attempting navigation so it is
      // always visible if the browser blocks or fails the http:// redirect
      // (e.g. ERR_CONNECTION_REFUSED when the CLI server has already shut
      // down, or Chrome's HTTPS-first mode interfering with localhost).
      flushSync(() => {
        setToken(result.token);
        setCallbackUrl(redirectUrl);
        setStatus("Redirecting to CLI…");
      });
      navigate(redirectUrl);
    };

    void run().catch((error) => {
      const message = error instanceof Error ? error.message : "Failed to create token";
      setStatus(message);
      setToken(null);
    });
  }, [createToken, isAuthenticated, label, me, navigate, redirectUri, registry, safeRedirect, state]);

  if (!safeRedirect) {
    return (
      <main className="py-10">
        <Container size="narrow">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">CLI login</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-[color:var(--ink-soft)]">Invalid redirect URL.</p>
              <p className="text-sm text-[color:var(--ink-soft)]">
                Run the CLI again to start a fresh login.
              </p>
            </CardContent>
          </Card>
        </Container>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="py-10">
        <Container size="narrow">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">CLI login</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-[color:var(--ink-soft)]">Missing state.</p>
              <p className="text-sm text-[color:var(--ink-soft)]">
                Run the CLI again to start a fresh login.
              </p>
            </CardContent>
          </Card>
        </Container>
      </main>
    );
  }

  if (!isAuthenticated || !me) {
    return (
      <main className="py-10">
        <Container size="narrow">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">CLI login</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-[color:var(--ink-soft)]">
                Sign in to create an API token for the CLI.
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
              <SignInButton
                variant="primary"
                disabled={isLoading}
              >
                Sign in with GitHub
              </SignInButton>
            </CardContent>
          </Card>
        </Container>
      </main>
    );
  }

  return (
    <main className="py-10">
      <Container size="narrow">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">CLI login</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[color:var(--ink-soft)]">{status}</p>
            {token ? (
              <div className="text-sm text-[color:var(--ink-soft)] overflow-x-auto">
                <div className="mb-2">
              If the redirect did not complete, copy this token and run{" "}
              <code>clawhub login --token &lt;token&gt;</code>:
            </div>
                <code className="font-mono text-xs">{token}</code>
                {callbackUrl ? (
                  <div className="mt-2">
                    <a href={callbackUrl}>Retry redirect to CLI</a>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}

function isAllowedRedirectUri(value: string) {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

function decodeLabel(value: string | undefined) {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const decoded = new TextDecoder().decode(bytes);
    const label = decoded.trim();
    if (!label) return null;
    return label.slice(0, 80);
  } catch {
    return null;
  }
}
