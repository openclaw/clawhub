import { describe, expect, it } from "vitest";
import {
  ANALYTICS_POLICY_VERSION,
  analyticsConsentDecision,
  makeAnalyticsChoice,
  parseAnalyticsRegion,
  readAnalyticsChoice,
  hasInitialAnalyticsGrant,
  ANALYTICS_CHOICE_KEY,
} from "./analyticsConsent";

describe("regional analytics consent", () => {
  const now = Date.parse("2026-10-02T18:00:00Z");
  it("accepts only current, correctly versioned first-party policy responses", () => {
    for (const region of ["opt_in", "notice_opt_out", "unknown"] as const)
      expect(
        parseAnalyticsRegion({
          schema_version: 1,
          policy_version: ANALYTICS_POLICY_VERSION,
          region_class: region,
        }),
      ).toBe(region);
    for (const payload of [
      null,
      {},
      { schema_version: 1, policy_version: "old", region_class: "notice_opt_out" },
      { schema_version: 1, policy_version: ANALYTICS_POLICY_VERSION, region_class: "US" },
    ])
      expect(parseAnalyticsRegion(payload)).toBe("unknown");
  });
  it("validates explicit choice version, time, and 180-day expiry", () => {
    expect(readAnalyticsChoice(makeAnalyticsChoice("granted", now), now)).toBe("granted");
    expect(readAnalyticsChoice(makeAnalyticsChoice("denied", now), now)).toBe("denied");
    expect(readAnalyticsChoice(makeAnalyticsChoice("granted", now + 1), now)).toBeNull();
    expect(
      readAnalyticsChoice(makeAnalyticsChoice("granted", now), now + 180 * 86400000),
    ).toBeNull();
    const valid = JSON.parse(makeAnalyticsChoice("granted", now));
    for (const patch of [
      { policy_version: "old" },
      { schema_version: 2 },
      { analytics: true },
      { updated_at: "bad" },
      { expires_at: new Date(now + 181 * 86400000).toISOString() },
    ])
      expect(readAnalyticsChoice(JSON.stringify({ ...valid, ...patch }), now)).toBeNull();
    expect(readAnalyticsChoice("not json", now)).toBeNull();
  });
  it("admits buffered initial entries only when the grant predates the document", () => {
    const granted = Date.now() - 1000;
    localStorage.setItem(ANALYTICS_CHOICE_KEY, makeAnalyticsChoice("granted", granted));
    expect(hasInitialAnalyticsGrant(granted - 1)).toBe(false);
    expect(hasInitialAnalyticsGrant(granted)).toBe(true);
    expect(hasInitialAnalyticsGrant(granted + 500)).toBe(true);
    localStorage.removeItem(ANALYTICS_CHOICE_KEY);
  });
  it("keeps unknown/opt-in regions closed except for explicit allow", () => {
    for (const region of ["unknown", "opt_in"] as const) {
      expect(
        analyticsConsentDecision({
          region,
          choice: null,
          privacySignal: false,
          storageError: false,
          noticeShown: true,
        }),
      ).toBe(false);
      expect(
        analyticsConsentDecision({
          region,
          choice: "granted",
          privacySignal: false,
          storageError: false,
          noticeShown: false,
        }),
      ).toBe(true);
    }
  });
  it("requires a shown notice for a regional default and lets deny/privacy/storage override", () => {
    const input = {
      region: "notice_opt_out" as const,
      choice: null,
      privacySignal: false,
      storageError: false,
      noticeShown: false,
    };
    expect(analyticsConsentDecision(input)).toBe(false);
    expect(analyticsConsentDecision({ ...input, noticeShown: true })).toBe(true);
    expect(analyticsConsentDecision({ ...input, choice: "denied", noticeShown: true })).toBe(false);
    expect(analyticsConsentDecision({ ...input, choice: "granted", privacySignal: true })).toBe(
      false,
    );
    expect(analyticsConsentDecision({ ...input, choice: "granted", storageError: true })).toBe(
      false,
    );
  });
});
