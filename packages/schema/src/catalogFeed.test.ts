import { describe, expect, it } from "vitest";
import {
  CATALOG_FEED_GITHUB_SOURCE_REF,
  CATALOG_FEED_ID,
  CATALOG_FEED_SCHEMA_VERSION,
  CATALOG_FEED_SOURCE_REF,
  CATALOG_SKILLS_FEED_ID,
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

  it("accepts skill entries in a skills feed", () => {
    const feed = makeFeed({
      id: CATALOG_SKILLS_FEED_ID,
      entries: [
        {
          type: "skill",
          id: "@openclaw/demo",
          title: "Demo",
          version: "1.0.0",
          state: "available",
          publisher: { id: "openclaw", trust: "official" },
          install: {
            candidates: [
              {
                sourceRef: CATALOG_FEED_SOURCE_REF,
                package: "@openclaw/demo",
                version: "1.0.0",
                integrity: "sha256:abc",
              },
            ],
          },
        },
      ],
    });

    expect(parseCatalogFeed(feed).entries[0]?.type).toBe("skill");
  });

  it("preserves public GitHub source identity on skill candidates", () => {
    const feed = makeFeed({
      id: CATALOG_SKILLS_FEED_ID,
      entries: [
        {
          type: "skill",
          id: "@nvidia/aiq-deploy",
          title: "AIQ Deploy",
          version: "1111111111111111111111111111111111111111",
          state: "available",
          publisher: { id: "nvidia", trust: "official" },
          install: {
            candidates: [
              {
                sourceRef: CATALOG_FEED_GITHUB_SOURCE_REF,
                package: "@nvidia/aiq-deploy",
                version: "1111111111111111111111111111111111111111",
                integrity: "sha256:hash-aiq-deploy",
                github: {
                  repo: "NVIDIA/skills",
                  path: "skills/aiq-deploy",
                  commit: "1111111111111111111111111111111111111111",
                  contentHash: "hash-aiq-deploy",
                },
              },
            ],
          },
        },
      ],
    });

    const serialized = serializeCatalogFeed(feed);
    const parsed = parseCatalogFeed(JSON.parse(serialized));

    expect(parsed.entries[0]?.install.candidates[0]).toEqual({
      sourceRef: "public-github",
      package: "@nvidia/aiq-deploy",
      version: "1111111111111111111111111111111111111111",
      integrity: "sha256:hash-aiq-deploy",
      github: {
        repo: "NVIDIA/skills",
        path: "skills/aiq-deploy",
        commit: "1111111111111111111111111111111111111111",
        contentHash: "hash-aiq-deploy",
      },
    });
  });
});
