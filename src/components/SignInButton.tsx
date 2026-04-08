import { useAuthActions } from "@convex-dev/auth/react";
import type { ComponentProps } from "react";
import { getUserFacingAuthError } from "../lib/authErrorMessage";
import { clearAuthError, setAuthError } from "../lib/useAuthError";
import { Button } from "./ui/button";

type ButtonProps = ComponentProps<typeof Button>;

type SignInButtonProps = Omit<ButtonProps, "onClick" | "type"> & {
  redirectTo?: string;
};

export function SignInButton({
  redirectTo,
  children = "Sign in with GitHub",
  ...props
}: SignInButtonProps) {
  const { signIn } = useAuthActions();

  return (
    <Button
      type="button"
      onClick={() => {
        clearAuthError();
        const next = redirectTo ?? getCurrentRelativeUrl();
        void signIn("github", next ? { redirectTo: next } : undefined)
          .then((result) => {
            if (result?.signingIn === false) {
              setAuthError("Sign in failed. Please try again.");
            }
          })
          .catch((error) => {
            setAuthError(
              getUserFacingAuthError(error, "Sign in failed. Please try again."),
            );
          });
      }}
      {...props}
    >
      {children}
    </Button>
  );
}

function getCurrentRelativeUrl() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
