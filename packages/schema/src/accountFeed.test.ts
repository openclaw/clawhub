import { describe, expect, it } from "vitest";
import {
  ACCOUNT_FEED_SCHEMA_VERSION,
  accountFeedId,
  parseAccountFeed,
  type AccountFeed,
} from "./accountFeed.js";

function makeFeed(overrides: Partial<AccountFeed> = {}): AccountFeed {
  return {
    schemaVersion: ACCOUNT_FEED_SCHEMA_VERSION,
    feedId: accountFeedId("publisher", "publishers:demo"),
    scope: "publisher",
    accountId: null,
    publisherId: "publishers:demo",
    handle: "demo",
    displayName: "Demo Publisher",
    generatedAt: "2026-07-02T00:00:00.000Z",
    sequence: 0,
    entries: [
      {
        kind: "skill",
        id: "skills:demo",
        name: "demo-skill",
        displayName: "Demo Skill",
        summary: null,
        url: "/demo/demo-skill",
        updatedAt: 10,
      },
    ],
    nextCursor: null,
    ...overrides,
  };
}

describe("account feed schema", () => {
  it("builds stable account and publisher feed ids", () => {
    expect(accountFeedId("account", "users:alice")).toBe("clawhub.account.users:alice");
    expect(accountFeedId("publisher", "publishers:alice")).toBe(
      "clawhub.publisher.publishers:alice",
    );
  });

  it("accepts the first account feed contract", () => {
    expect(parseAccountFeed(makeFeed()).entries[0]?.kind).toBe("skill");
  });

  it("rejects unsupported versions and malformed entries", () => {
    expect(() => parseAccountFeed(makeFeed({ schemaVersion: 2 }))).toThrow(
      "Unsupported account feed schema version",
    );
    expect(() =>
      parseAccountFeed(
        makeFeed({
          entries: [{ kind: "skill", id: "skills:demo" }] as never,
        }),
      ),
    ).toThrow();
  });

  it("binds feed identity to its scope", () => {
    expect(() => parseAccountFeed(makeFeed({ publisherId: null }))).toThrow(
      "publisher feed must include its stable identity",
    );
    expect(() => parseAccountFeed(makeFeed({ feedId: "clawhub.publisher.other" }))).toThrow(
      "feed id does not match",
    );
  });

  it("validates entry timestamps and URL references", () => {
    const entry = makeFeed().entries[0]!;
    expect(() =>
      parseAccountFeed(makeFeed({ entries: [{ ...entry, updatedAt: Number.NaN }] })),
    ).toThrow("updatedAt");
    expect(() =>
      parseAccountFeed(makeFeed({ entries: [{ ...entry, url: "//evil.example/skill" }] })),
    ).toThrow("protocol-relative");
    expect(() =>
      parseAccountFeed(makeFeed({ entries: [{ ...entry, url: "http://example.com/skill" }] })),
    ).toThrow("absolute HTTPS");
    expect(
      parseAccountFeed(makeFeed({ entries: [{ ...entry, url: "https://example.com/skill" }] })),
    ).toBeDefined();
  });
});
