import { describe, expect, it } from "vitest";
import {
  CLAWHUB_PLATFORM_CHANGELOG_URL,
  PLATFORM_CHANGELOG_ENTRIES,
} from "./platformChangelog";

describe("platformChangelog", () => {
  it("lists curated platform updates with categories and links", () => {
    expect(PLATFORM_CHANGELOG_ENTRIES.length).toBeGreaterThan(0);

    for (const entry of PLATFORM_CHANGELOG_ENTRIES) {
      expect(entry.category).toMatch(/^(Feature|Improvement)$/);
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.when.trim().length).toBeGreaterThan(0);
      expect(Boolean(entry.to) || Boolean(entry.href)).toBe(true);
    }
  });

  it("points the full changelog link at GitHub releases", () => {
    expect(CLAWHUB_PLATFORM_CHANGELOG_URL).toBe(
      "https://github.com/openclaw/clawhub/releases",
    );
  });
});
