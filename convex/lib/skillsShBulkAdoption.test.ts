import { describe, expect, it, vi } from "vitest";
import {
  buildBulkAdoptionPreviewItem,
  orchestrateBulkAdoptionBatch,
  selectBulkAdoptionRequests,
  type BulkAdoptionCatalogEntry,
  type BulkAdoptionPreviewItem,
} from "./skillsShBulkAdoption";

const publisherId = "publishers:openclaw";

function makeEntry(
  externalId: string,
  overrides: Partial<BulkAdoptionCatalogEntry> = {},
): BulkAdoptionCatalogEntry {
  const [owner, repo, slug] = externalId.split("/");
  return {
    externalId,
    githubOwnerId: 1_234,
    owner: owner!,
    repo: repo!,
    slug: slug!,
    displayName: slug!,
    sourceUrl: `https://skills.sh/${externalId}`,
    githubRepoUrl: `https://github.com/${owner}/${repo}`,
    githubPath: `skills/${slug}`,
    githubCommit: "abc123",
    githubContentHash: `github-${slug}`,
    sourceContentHash: `source-${slug}`,
    ...overrides,
  };
}

function makePreviewItems(): BulkAdoptionPreviewItem[] {
  return [
    buildBulkAdoptionPreviewItem({
      publisherId,
      entry: makeEntry("legacy/openclaw/new-skill"),
      destination: { kind: "none" },
    }),
    buildBulkAdoptionPreviewItem({
      publisherId,
      entry: makeEntry("openclaw/openclaw/discrawl"),
      destination: {
        kind: "owned",
        skillId: "skills:discrawl",
        ownerPublisherId: publisherId,
        ownerHandle: "openclaw",
        slug: "discrawl",
        displayName: "Discrawl",
        activeVersion: "1.2.3",
      },
    }),
    buildBulkAdoptionPreviewItem({
      publisherId,
      entry: makeEntry("openclaw/openclaw/missing-commit", {
        githubCommit: undefined,
      }),
      destination: { kind: "none" },
    }),
    buildBulkAdoptionPreviewItem({
      publisherId,
      entry: makeEntry("openclaw/openclaw/conflict"),
      destination: {
        kind: "owned",
        skillId: "skills:conflict",
        ownerPublisherId: "publishers:other",
        ownerHandle: "other",
        slug: "conflict",
        displayName: "Conflict",
      },
    }),
  ];
}

describe("skills.sh publisher bulk adoption", () => {
  it("classifies new destinations, replacements, unavailable sources, and conflicts", () => {
    const [created, replacement, unavailable, conflict] = makePreviewItems();

    expect(created).toMatchObject({
      classification: "new-destination",
      eligible: true,
      destination: null,
    });
    expect(replacement).toMatchObject({
      classification: "replacement",
      eligible: true,
      destination: {
        skillId: "skills:discrawl",
        ownerHandle: "openclaw",
        activeVersion: "1.2.3",
      },
    });
    expect(unavailable).toMatchObject({
      classification: "unavailable",
      eligible: false,
      reason: "missing-exact-source",
    });
    expect(conflict).toMatchObject({
      classification: "ownership-conflict",
      eligible: false,
      reason: "destination-owned-by-another-publisher",
      destination: {
        skillId: "skills:conflict",
        ownerHandle: "other",
      },
    });
  });

  it("selects individual entries or every eligible entry with stable request keys", () => {
    const preview = makePreviewItems();

    const all = selectBulkAdoptionRequests({
      publisherId,
      preview,
      selection: { kind: "all-eligible" },
    });
    expect(all.requests.map((request) => request.externalId)).toEqual([
      "legacy/openclaw/new-skill",
      "openclaw/openclaw/discrawl",
    ]);
    expect(all.rejected).toEqual([]);
    expect(all.requests[0]?.idempotencyKey).toBe(
      "skills-sh-adoption:v1:publishers:openclaw:legacy/openclaw/new-skill:source-new-skill",
    );
    expect(all.requests[0]).toEqual({
      publisherId,
      externalId: "legacy/openclaw/new-skill",
      sourceContentHash: "source-new-skill",
      idempotencyKey:
        "skills-sh-adoption:v1:publishers:openclaw:legacy/openclaw/new-skill:source-new-skill",
    });

    const individual = selectBulkAdoptionRequests({
      publisherId,
      preview,
      selection: {
        kind: "entries",
        externalIds: [
          "openclaw/openclaw/discrawl",
          "openclaw/openclaw/discrawl",
          "openclaw/openclaw/conflict",
          "not/in/preview",
        ],
      },
    });
    expect(individual.requests).toHaveLength(1);
    expect(individual.requests[0]?.externalId).toBe("openclaw/openclaw/discrawl");
    expect(individual.rejected).toEqual([
      {
        externalId: "openclaw/openclaw/conflict",
        classification: "ownership-conflict",
        reason: "destination-owned-by-another-publisher",
      },
      {
        externalId: "not/in/preview",
        classification: "not-in-preview",
        reason: "entry-not-in-preview",
      },
    ]);
  });

  it("rejects a preview that was authorized for another publisher", () => {
    expect(() =>
      selectBulkAdoptionRequests({
        publisherId: "publishers:other",
        preview: makePreviewItems(),
        selection: { kind: "all-eligible" },
      }),
    ).toThrow("Cannot adopt skills.sh entry legacy/openclaw/new-skill for a different publisher");
  });

  it("pauses before work and processes only a bounded number of separate adoptions", async () => {
    const selected = selectBulkAdoptionRequests({
      publisherId,
      preview: makePreviewItems(),
      selection: { kind: "all-eligible" },
    }).requests;
    const startAdoption = vi.fn(async (request) => ({
      adoptionId: `adoption:${request.externalId}`,
    }));

    const paused = await orchestrateBulkAdoptionBatch({
      requests: selected,
      progress: [],
      paused: true,
      maxItems: 1,
      startAdoption,
    });
    expect(paused).toMatchObject({
      attempted: 0,
      remaining: 2,
      paused: true,
      done: false,
    });
    expect(startAdoption).not.toHaveBeenCalled();

    const first = await orchestrateBulkAdoptionBatch({
      requests: selected,
      progress: paused.progress,
      paused: false,
      maxItems: 1,
      startAdoption,
    });
    expect(first).toMatchObject({
      attempted: 1,
      completed: 1,
      failed: 0,
      remaining: 1,
      paused: false,
      done: false,
    });
    expect(startAdoption).toHaveBeenCalledTimes(1);

    const second = await orchestrateBulkAdoptionBatch({
      requests: selected,
      progress: first.progress,
      paused: false,
      maxItems: 1,
      startAdoption,
    });
    expect(second).toMatchObject({
      attempted: 1,
      completed: 1,
      failed: 0,
      remaining: 0,
      done: true,
    });
    expect(startAdoption).toHaveBeenCalledTimes(2);

    const unchangedRetry = await orchestrateBulkAdoptionBatch({
      requests: selected,
      progress: second.progress,
      paused: false,
      maxItems: 2,
      startAdoption,
    });
    expect(unchangedRetry).toMatchObject({
      attempted: 0,
      remaining: 0,
      done: true,
    });
    expect(startAdoption).toHaveBeenCalledTimes(2);
  });

  it("records a failed item, stops the batch, and retries with the same idempotency key", async () => {
    const [request] = selectBulkAdoptionRequests({
      publisherId,
      preview: makePreviewItems(),
      selection: { kind: "all-eligible" },
    }).requests;
    const startAdoption = vi
      .fn()
      .mockRejectedValueOnce(new Error("CLAW-560 temporarily unavailable"))
      .mockResolvedValueOnce({ adoptionId: "adoption:new-skill" });

    const failed = await orchestrateBulkAdoptionBatch({
      requests: [request!],
      progress: [],
      paused: false,
      maxItems: 1,
      startAdoption,
    });
    expect(failed).toMatchObject({
      attempted: 1,
      completed: 0,
      failed: 1,
      remaining: 1,
      paused: true,
      done: false,
    });
    expect(failed.progress[0]).toMatchObject({
      idempotencyKey: request!.idempotencyKey,
      status: "failed",
      attempts: 1,
      error: "CLAW-560 temporarily unavailable",
    });

    const retried = await orchestrateBulkAdoptionBatch({
      requests: [request!],
      progress: failed.progress,
      paused: false,
      maxItems: 1,
      startAdoption,
    });
    expect(retried).toMatchObject({
      attempted: 1,
      completed: 1,
      failed: 0,
      remaining: 0,
      done: true,
    });
    expect(startAdoption.mock.calls[0]?.[0].idempotencyKey).toBe(request!.idempotencyKey);
    expect(startAdoption.mock.calls[1]?.[0].idempotencyKey).toBe(request!.idempotencyKey);
  });
});
