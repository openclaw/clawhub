import { afterEach, describe, expect, it } from "vitest";
import { clearAuthError, getAuthErrorSnapshot, setAuthError } from "./useAuthError";

afterEach(() => {
  clearAuthError();
});

describe("auth error store", () => {
  it("stores the latest auth error", () => {
    setAuthError("test error");

    expect(getAuthErrorSnapshot()).toBe("test error");
  });

  it("clears the stored error", () => {
    setAuthError("test error");

    clearAuthError();

    expect(getAuthErrorSnapshot()).toBeNull();
  });
});
