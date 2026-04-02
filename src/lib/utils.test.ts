import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges class names", () => {
    const maybe: string | undefined = undefined;
    expect(cn("a", maybe ? "b" : undefined, "c")).toBe("a c");
  });
});
