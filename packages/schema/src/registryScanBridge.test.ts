import { describe, expect, it } from "vitest";
import { CATALOG_FEED_ID, CATALOG_FEED_SOURCE_REF, type CatalogFeedEntry } from "./catalogFeed.js";
import { buildOpenClawRegistryExport } from "./registryScanBridge.js";

function makeEntry(overrides: Partial<CatalogFeedEntry> = {}): CatalogFeedEntry {
  return {
    type: "plugin",
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
          integrity: "sha256:artifact",
        },
      ],
    },
    ...overrides,
  };
}

describe("OpenClaw registry scan bridge", () => {
  it("projects explicit ClawHub feed facts without adding OpenClaw approval", () => {
    const exported = buildOpenClawRegistryExport({
      feedId: CATALOG_FEED_ID,
      feedSequence: 42,
      feedPayloadDigest: "sha256:payload",
      entry: makeEntry(),
      exportedAt: "2026-07-02T00:00:00.000Z",
      exportActorId: "system:catalog-feed",
    });

    expect(exported).toMatchObject({
      schemaVersion: 1,
      exportedAt: "2026-07-02T00:00:00.000Z",
      exportActorId: "system:catalog-feed",
      clawhub: {
        feed: {
          id: "clawhub-official",
          sequence: 42,
          payloadDigest: "sha256:payload",
          entryId: "@openclaw/demo",
          entryState: "available",
        },
        publisher: {
          id: "openclaw",
          official: true,
        },
        candidate: {
          kind: "plugin",
          id: "@openclaw/demo",
          package: "@openclaw/demo",
          sourceRef: "public-clawhub",
          sourceType: "clawhub",
          artifactDigest: "sha256:artifact",
          github: null,
        },
        scanState: null,
        reviewState: null,
      },
      openclaw: {
        reviewState: null,
        scanState: null,
        registryState: null,
        reviewId: null,
      },
    });
    expect(exported.exportId).toBe(exported.idempotencyKey);
    expect(exported.idempotencyKey).toContain("openclaw-registry-export-v1");
  });

  it("keeps GitHub source facts as candidate provenance", () => {
    const exported = buildOpenClawRegistryExport({
      feedId: "clawhub-official-skills",
      feedSequence: 3,
      entry: makeEntry({
        type: "skill",
        id: "@nvidia/aiq-deploy",
        publisher: { id: "nvidia", trust: "official" },
        install: {
          candidates: [
            {
              sourceRef: "public-github",
              package: "@nvidia/aiq-deploy",
              version: "1111111111111111111111111111111111111111",
              integrity: "sha256:content",
              github: {
                repo: "NVIDIA/skills",
                path: "skills/aiq-deploy",
                commit: "1111111111111111111111111111111111111111",
                contentHash: "content",
              },
            },
          ],
        },
      }),
      exportedAt: "2026-07-02T00:00:00.000Z",
    });

    expect(exported.clawhub.candidate).toMatchObject({
      kind: "skill",
      sourceRef: "public-github",
      sourceType: "github",
      github: {
        repo: "NVIDIA/skills",
        path: "skills/aiq-deploy",
        commit: "1111111111111111111111111111111111111111",
        contentHash: "content",
      },
    });
  });

  it("accepts copied GitHub candidates with equivalent provenance fields", () => {
    const entry = makeEntry({
      type: "skill",
      id: "@nvidia/aiq-deploy",
      install: {
        candidates: [
          {
            sourceRef: "public-github",
            package: "@nvidia/aiq-deploy",
            version: "1111111111111111111111111111111111111111",
            integrity: "sha256:content",
            github: {
              repo: "NVIDIA/skills",
              path: "skills/aiq-deploy",
              commit: "1111111111111111111111111111111111111111",
              contentHash: "content",
            },
          },
        ],
      },
    });

    const exported = buildOpenClawRegistryExport({
      feedId: "clawhub-official-skills",
      feedSequence: 3,
      entry,
      candidate: {
        sourceRef: "public-github",
        package: "@nvidia/aiq-deploy",
        version: "1111111111111111111111111111111111111111",
        integrity: "sha256:content",
        github: {
          contentHash: "content",
          commit: "1111111111111111111111111111111111111111",
          path: "skills/aiq-deploy",
          repo: "NVIDIA/skills",
        },
      },
      exportedAt: "2026-07-02T00:00:00.000Z",
    });

    expect(exported.clawhub.candidate.github?.repo).toBe("NVIDIA/skills");
  });

  it("uses feed revision and candidate facts for duplicate suppression", () => {
    const entry = makeEntry();
    const first = buildOpenClawRegistryExport({
      feedId: CATALOG_FEED_ID,
      feedSequence: 1,
      entry,
      exportedAt: "2026-07-02T00:00:00.000Z",
    });
    const retry = buildOpenClawRegistryExport({
      feedId: CATALOG_FEED_ID,
      feedSequence: 1,
      entry,
      exportedAt: "2026-07-02T01:00:00.000Z",
    });
    const resubmission = buildOpenClawRegistryExport({
      feedId: CATALOG_FEED_ID,
      feedSequence: 2,
      entry,
      exportedAt: "2026-07-02T01:00:00.000Z",
    });

    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(resubmission.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("includes GitHub provenance in the duplicate suppression key", () => {
    const first = buildOpenClawRegistryExport({
      feedId: "clawhub-official-skills",
      feedSequence: 1,
      entry: makeEntry({
        type: "skill",
        id: "@nvidia/demo",
        install: {
          candidates: [
            {
              sourceRef: "public-github",
              package: "@nvidia/demo",
              version: "1",
              integrity: "sha256:same",
              github: { repo: "NVIDIA/skills", path: "one", commit: "1", contentHash: "same" },
            },
          ],
        },
      }),
      exportedAt: "2026-07-02T00:00:00.000Z",
    });
    const second = buildOpenClawRegistryExport({
      feedId: "clawhub-official-skills",
      feedSequence: 1,
      entry: makeEntry({
        type: "skill",
        id: "@nvidia/demo",
        install: {
          candidates: [
            {
              sourceRef: "public-github",
              package: "@nvidia/demo",
              version: "1",
              integrity: "sha256:same",
              github: { repo: "NVIDIA/skills", path: "two", commit: "1", contentHash: "same" },
            },
          ],
        },
      }),
      exportedAt: "2026-07-02T00:00:00.000Z",
    });

    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("rejects candidates that are not present on the exported feed entry", () => {
    expect(() =>
      buildOpenClawRegistryExport({
        feedId: CATALOG_FEED_ID,
        feedSequence: 1,
        entry: makeEntry(),
        candidate: {
          sourceRef: "public-clawhub",
          package: "@other/demo",
          version: "1.0.0",
          integrity: "sha256:other",
        },
        exportedAt: "2026-07-02T00:00:00.000Z",
      }),
    ).toThrow("candidate must belong to the feed entry");
  });

  it("carries non-available entry state as a separate ClawHub fact", () => {
    const exported = buildOpenClawRegistryExport({
      feedId: CATALOG_FEED_ID,
      feedSequence: 1,
      entry: makeEntry({ state: "blocked" }),
      exportedAt: "2026-07-02T00:00:00.000Z",
    });

    expect(exported.clawhub.feed.entryState).toBe("blocked");
    expect(exported.openclaw.registryState).toBeNull();
  });
});
