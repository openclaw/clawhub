import {
  getUserFacingAuthError,
  isBannedAccountAuthError,
  routeToBannedAccountPage,
} from "./authErrorMessage";
import { setAuthError } from "./useAuthError";

export function handleSignInError(error: unknown) {
  const message = getUserFacingAuthError(error, "Sign in failed. Please try again.");
  if (isBannedAccountAuthError(message)) {
    routeToBannedAccountPage();
    return;
  }
  setAuthError(message);
}
