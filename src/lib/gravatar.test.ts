import { describe, expect, it } from "vitest";
import { gravatarUrl } from "./gravatar";

describe("gravatarUrl", () => {
  it("generates a stable hash", () => {
    const url = gravatarUrl("MyEmailAddress@example.com ");
    expect(url).toContain("0bc83cb571cd1c50ba6f3e8a78ef1346");
  });
});
