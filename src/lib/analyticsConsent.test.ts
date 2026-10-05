import { afterEach, describe, expect, it, vi } from "vitest";
import { hasAnalyticsPrivacySignal } from "./analyticsConsent";

afterEach(() => vi.restoreAllMocks());
describe("browser analytics privacy signals", () => {
  it.each([
    [false, null, false],
    [false, "0", false],
    [false, "unspecified", false],
    [true, null, true],
    [false, "1", true],
    [true, "1", true],
  ])("recognizes GPC %s and DNT %s", (gpc, dnt, expected) => {
    const browser = {
      navigator: { globalPrivacyControl: gpc, doNotTrack: dnt },
    } as unknown as Window;
    expect(hasAnalyticsPrivacySignal(browser)).toBe(expected);
  });
  it("does not consult storage for browser privacy", () => {
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
    Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: null });
    expect(hasAnalyticsPrivacySignal()).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
});
