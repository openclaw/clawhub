import type { LucideIcon } from "lucide-react";
import { LockKeyhole } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { isBannedAccountAuthError, routeToBannedAccountPage } from "../lib/authErrorMessage";
import { useAuthError } from "../lib/useAuthError";
import { AuthErrorMessage } from "./AuthErrorMessage";
import { GitHubIcon as GitHubLogo } from "./BrandIcons";
import { SignInButton } from "./SignInButton";

interface SignInPromptProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  showAction?: boolean;
  error?: string | null;
  onDismissError?: () => void;
  className?: string;
}

export function SignInPrompt({
  title,
  description,
  icon: Icon = LockKeyhole,
  action,
  showAction = true,
  error,
  onDismissError,
  className,
}: SignInPromptProps) {
  const { error: globalAuthError, clear: clearGlobalAuthError } = useAuthError();
  const rawVisibleError = error ?? globalAuthError;
  const isBannedAuthError = isBannedAccountAuthError(rawVisibleError);
  const visibleError = isBannedAuthError ? null : rawVisibleError;
  const dismissVisibleError = error
    ? onDismissError
    : (onDismissError ?? (globalAuthError ? clearGlobalAuthError : undefined));

  useEffect(() => {
    if (!isBannedAuthError) return;
    if (globalAuthError) clearGlobalAuthError();
    routeToBannedAccountPage();
  }, [clearGlobalAuthError, globalAuthError, isBannedAuthError]);

  const defaultAction = (
    <SignInButton
      size="sm"
      className="min-h-10 w-full shrink-0 border-[color-mix(in_srgb,var(--accent)_82%,var(--border-ui))] bg-transparent px-4 text-sm text-[color:var(--ink)] hover:not-disabled:border-[color:var(--accent)] hover:not-disabled:bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] sm:w-auto"
    >
      <GitHubLogo className="h-4 w-4" />
      Sign in with GitHub
    </SignInButton>
  );

  return (
    <main
      className={`relative mx-auto flex min-h-[430px] w-full flex-col overflow-hidden px-4 pb-12 pt-20 sm:px-6 sm:pt-24 lg:px-6 ${className ?? ""}`}
      style={{ maxWidth: "var(--page-max)" }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-20 inset-x-10 h-64"
        style={{
          background:
            "linear-gradient(to bottom, color-mix(in srgb, var(--accent) 22%, transparent), color-mix(in srgb, var(--accent) 5%, transparent) 42%, transparent 74%)",
          filter: "blur(2px)",
          maskImage: "linear-gradient(to right, transparent, black 22%, black 78%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 22%, black 78%, transparent)",
        }}
      />
      <section className="relative z-10 mx-auto w-full max-w-[980px]">
        <div className="relative isolate flex min-w-0 flex-col gap-6 overflow-hidden rounded-[var(--oc-radius-surface)] border border-[color:var(--oc-border-subtle)] bg-[color:var(--oc-bg-elevated)] px-5 pb-10 pt-7 shadow-[var(--oc-shadow-lg)] sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-8 sm:pb-10">
          <div className="min-w-0">
            <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] text-[color:var(--ink-soft)] sm:h-12 sm:w-12">
              <Icon size={21} />
            </span>
            <h1 className="font-display text-xl font-black leading-tight text-[color:var(--ink)] sm:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[color:var(--ink-soft)] sm:text-base sm:leading-7">
                {description}
              </p>
            ) : null}
            {visibleError ? (
              <p
                className="mt-3 rounded-[var(--oc-radius-control)] border border-[color:color-mix(in_srgb,var(--oc-status-error-fg)_30%,var(--oc-border-subtle))] bg-[color:var(--oc-status-error-bg)] px-3 py-2 text-sm text-[color:var(--oc-status-error-fg)]"
                role="alert"
              >
                <AuthErrorMessage message={visibleError} />{" "}
                {dismissVisibleError ? (
                  <button
                    type="button"
                    onClick={dismissVisibleError}
                    aria-label="Dismiss"
                    className="cursor-pointer border-none bg-transparent px-0.5 text-inherit"
                  >
                    &times;
                  </button>
                ) : null}
              </p>
            ) : null}
          </div>
          {showAction ? (action ?? defaultAction) : null}
        </div>
      </section>
    </main>
  );
}
