import { describe, expect, it } from "vitest";
import { __test } from "./vt";

describe("vt activation fallback", () => {
  it("activates only VT-pending hidden skills", () => {
    expect(
      __test.shouldActivateWhenVtUnavailable({
        moderationStatus: "hidden",
        moderationReason: "pending.scan",
      }),
    ).toBe(true);

    expect(
      __test.shouldActivateWhenVtUnavailable({
        moderationStatus: "hidden",
        moderationReason: "scanner.vt.pending",
      }),
    ).toBe(true);

    expect(
      __test.shouldActivateWhenVtUnavailable({
        moderationStatus: "hidden",
        moderationReason: "pending.scan.stale",
      }),
    ).toBe(true);
  });

  it("does not activate quality or scanner-hidden skills", () => {
    expect(
      __test.shouldActivateWhenVtUnavailable({
        moderationStatus: "hidden",
        moderationReason: "quality.low",
      }),
    ).toBe(false);

    expect(
      __test.shouldActivateWhenVtUnavailable({
        moderationStatus: "hidden",
        moderationReason: "scanner.llm.malicious",
      }),
    ).toBe(false);
  });

  it("does not activate blocked or already-active skills", () => {
    expect(
      __test.shouldActivateWhenVtUnavailable({
        moderationStatus: "hidden",
        moderationReason: "pending.scan",
        moderationFlags: ["blocked.malware"],
      }),
    ).toBe(false);

    expect(
      __test.shouldActivateWhenVtUnavailable({
        moderationStatus: "active",
        moderationReason: "pending.scan",
      }),
    ).toBe(false);
  });
});

describe("vt AV engine fallback verdicts", () => {
  it("maps engine verdicts in severity order", () => {
    expect(
      __test.statusFromAvStats({
        malicious: 1,
        suspicious: 2,
        harmless: 10,
        undetected: 40,
      }),
    ).toBe("malicious");

    expect(
      __test.statusFromAvStats({
        malicious: 0,
        suspicious: 1,
        harmless: 10,
        undetected: 40,
      }),
    ).toBe("suspicious");

    expect(
      __test.statusFromAvStats({
        malicious: 0,
        suspicious: 0,
        harmless: 1,
        undetected: 40,
      }),
    ).toBe("clean");
  });

  it("keeps undetected-only results pending", () => {
    expect(
      __test.statusFromAvStats({
        malicious: 0,
        suspicious: 0,
        harmless: 0,
        undetected: 40,
      }),
    ).toBeNull();
  });
});
