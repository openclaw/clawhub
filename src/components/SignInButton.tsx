import { useAuthActions } from "@convex-dev/auth/react";
import type { ComponentProps } from "react";
import { getUserFacingAuthError } from "../lib/authErrorMessage";
import { clearAuthRedirectAttempt, markAuthRedirectAttempt } from "../lib/authRedirectAttempt";
import { clearAuthError, setAuthError } from "../lib/useAuthError";
import { Button } from "./ui/button";

type ButtonProps = ComponentProps<typeof Button>;

type SignInButtonProps = Omit<ButtonProps, "onClick" | "type"> & {
  redirectTo?: string;
};

export function SignInButton({ redirectTo, children = "Sign In", ...props }: SignInButtonProps) {
  const { signIn } = useAuthActions();

  return (
    <Button
      {...props}
      type="button"
      variant="primary"
      onClick={() => {
        clearAuthError();
        const next = redirectTo ?? getCurrentRelativeUrl();
        markAuthRedirectAttempt("github", next || "/");
        void signIn("github", next ? { redirectTo: next } : undefined)
          .then((result) => {
            if (result?.signingIn === false && !result.redirect) {
              clearAuthRedirectAttempt();
              setAuthError("Sign in failed. Please try again.");
            }
          })
          .catch((error) => {
            clearAuthRedirectAttempt();
            setAuthError(getUserFacingAuthError(error, "Sign in failed. Please try again."));
          });
      }}
    >
      {children}
    </Button>
  );
}

function getCurrentRelativeUrl() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
