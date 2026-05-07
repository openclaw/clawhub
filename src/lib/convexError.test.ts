import { describe, expect, it } from "vitest";
import { getUserFacingConvexError } from "./convexError";

describe("getUserFacingConvexError", () => {
  it("falls back when data is generic wrapper text", () => {
    expect(
      getUserFacingConvexError({ data: "Server Error Called by client" }, "Publish failed"),
    ).toBe("Publish failed");
  });

  it("unwraps convex wrapper text from Error messages", () => {
    expect(
      getUserFacingConvexError(
        new Error(
          "[CONVEX A] [Request ID: abc] Server Error Called by client ConvexError: Bad input",
        ),
        "fallback",
      ),
    ).toBe("Bad input");
  });

  it("preserves ownership errors as-is after cleanup", () => {
    expect(
      getUserFacingConvexError(new Error("Only the owner can publish soul updates"), "fallback"),
    ).toBe("Only the owner can publish soul updates");
  });

  it("expands generic authz denials into account-status aware messages", () => {
    expect(getUserFacingConvexError(new Error("Unauthorized"), "fallback")).toMatch(
      /deleted, banned, or disabled/,
    );
    expect(getUserFacingConvexError(new Error("Forbidden"), "fallback")).toMatch(
      /not in good standing/,
    );
  });

  it("returns fallback for unknown errors", () => {
    expect(getUserFacingConvexError("wat", "Publish failed")).toBe("Publish failed");
  });
});
