import { describe, expect, it } from "vitest";
import { presentationTitle } from "./presentationTitle";

describe("presentationTitle", () => {
  it("removes emoji without changing the underlying identity fallback", () => {
    expect(presentationTitle("🚀 Ship It ✨", "ship-it")).toBe("Ship It");
    expect(presentationTitle("🧑🏽‍💻", "developer-tools")).toBe("developer-tools");
  });
});
