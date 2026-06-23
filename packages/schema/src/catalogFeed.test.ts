import { describe, expect, it } from "vitest";
import {
  CATALOG_FEED_ID,
  CATALOG_FEED_SCHEMA_VERSION,
  CATALOG_FEED_SOURCE_REF,
  parseCatalogFeed,
  serializeCatalogFeed,
  type CatalogFeed,
} from "./catalogFeed.js";

function makeFeed(overrides: Partial<CatalogFeed> = {}): CatalogFeed {
  return {
    schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
    id: CATALOG_FEED_ID,
    generatedAt: "2026-06-23T00:00:00.000Z",
    sequence: 1,
    expiresAt: "2026-06-30T00:00:00.000Z",
    entries: [
      {
        type: "plugin",
        id: "zeta",
        title: "Zeta",
        version: "1.0.0",
        state: "available",
        publisher: { id: "openclaw", trust: "official" },
        install: {
          candidates: [
            {
              sourceRef: CATALOG_FEED_SOURCE_REF,
              package: "@openclaw/zeta",
              version: "1.0.0",
              integrity: "sha256:abc",
            },
          ],
        },
      },
      {
        type: "plugin",
        id: "alpha",
        title: "Alpha",
        version: "1.0.0",
        state: "available",
        publisher: { id: "openclaw", trust: "official" },
        install: {
          candidates: [
            {
              sourceRef: CATALOG_FEED_SOURCE_REF,
              package: "@openclaw/alpha",
              version: "1.0.0",
              integrity: "sha256:def",
            },
          ],
        },
      },
    ],
    ...overrides,
  };
}

describe("catalog feed schema", () => {
  it("sorts entries by stable id before serializing", () => {
    const serialized = serializeCatalogFeed(makeFeed());
    expect(serialized.indexOf('"id":"alpha"')).toBeLessThan(serialized.indexOf('"id":"zeta"'));
  });

  it("serializes equivalent objects to identical canonical bytes", () => {
    const feed = makeFeed();
    const reordered: CatalogFeed = {
      entries: feed.entries.map((entry) => ({
        install: {
          candidates: entry.install.candidates.map((candidate) => ({
            integrity: candidate.integrity,
            version: candidate.version,
            package: candidate.package,
            sourceRef: candidate.sourceRef,
          })),
        },
        publisher: entry.publisher,
        state: entry.state,
        version: entry.version,
        title: entry.title,
        id: entry.id,
        type: entry.type,
      })),
      expiresAt: feed.expiresAt,
      sequence: feed.sequence,
      generatedAt: feed.generatedAt,
      id: feed.id,
      schemaVersion: feed.schemaVersion,
    };

    expect(serializeCatalogFeed(feed)).toBe(serializeCatalogFeed(reordered));
  });

  it("rejects unsupported versions and expired feeds", () => {
    expect(() => parseCatalogFeed(makeFeed({ schemaVersion: 2 } as never))).toThrow(
      "Unsupported catalog feed schema version",
    );
    expect(() => parseCatalogFeed(makeFeed({ expiresAt: "2026-06-22T00:00:00.000Z" }))).toThrow(
      "expiresAt must be after generatedAt",
    );
  });

  it("rejects malformed install candidates", () => {
    expect(() =>
      parseCatalogFeed(
        makeFeed({
          entries: [
            {
              ...makeFeed().entries[0],
              install: { candidates: [{ sourceRef: CATALOG_FEED_SOURCE_REF }] },
            },
          ],
        } as never),
      ),
    ).toThrow();
  });
});
