import type { LucideIcon } from "lucide-react";
import { LockKeyhole } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { isBannedAccountAuthError, routeToBannedAccountPage } from "../lib/authErrorMessage";
import { useAuthError } from "../lib/useAuthError";
import { AuthErrorMessage } from "./AuthErrorMessage";
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

function GitHubLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18.92-.26 1.9-.38 2.88-.39.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.42-2.69 5.39-5.25 5.67.42.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
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
