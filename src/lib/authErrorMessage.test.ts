import { describe, expect, it } from "vitest";
import {
  ACCOUNT_APPEAL_LINK_TEXT,
  ACCOUNT_APPEAL_URL,
  BANNED_ACCOUNT_PATH,
  BANNED_SIGN_IN_MESSAGE,
  getUserFacingAuthError,
  isBannedAccountAuthError,
  normalizeAuthErrorMessage,
  routeToBannedAccountPage,
} from "./authErrorMessage";

describe("authErrorMessage", () => {
  it("routes banned-account sign-in errors to the appeals site", () => {
    expect(normalizeAuthErrorMessage("Account banned", "fallback")).toBe(BANNED_SIGN_IN_MESSAGE);
    expect(isBannedAccountAuthError("This account has been disabled.")).toBe(true);
    expect(BANNED_SIGN_IN_MESSAGE).toContain(ACCOUNT_APPEAL_LINK_TEXT);
    expect(ACCOUNT_APPEAL_URL).toBe("https://appeals.openclaw.ai/");
  });

  it("navigates banned-account auth failures to the dedicated page", () => {
    window.history.replaceState(null, "", "/dashboard?error_description=Account%20banned");

    routeToBannedAccountPage();

    expect(window.location.pathname).toBe(BANNED_ACCOUNT_PATH);
    expect(window.location.search).toBe("");
  });

  it("does not route deleted-account errors to appeals", () => {
    expect(
      normalizeAuthErrorMessage(
        "This account has been permanently deleted and cannot be restored.",
        "fallback",
      ),
    ).toBe("This ClawHub account was permanently deleted and cannot sign in again.");
  });

  it("does not treat generic permission denials as banned sign-in failures", () => {
    const message = getUserFacingAuthError(new Error("Forbidden"), "fallback");

    expect(message).toBe(
      "This ClawHub account does not have permission to perform this action, or the account is not in good standing.",
    );
    expect(isBannedAccountAuthError(message)).toBe(false);
  });
});
