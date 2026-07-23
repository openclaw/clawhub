import { describe, expect, it } from "vitest";
import {
  decideMirroredRefresh,
  resolveAdoptedActiveSource,
  shouldPromoteAdoptedCandidate,
} from "./skillsShRefreshLifecycle";

const mirrored = {
  externalId: "openclaw/skills/discrawl",
  observationVersion: 10,
  presence: "present" as const,
  sourceUrl: "https://skills.sh/openclaw/skills/discrawl",
  githubPath: "skills/discrawl",
  githubCommit: "a".repeat(40),
  sourceContentHash: "content-a",
};

const adoptedIdentity = {
  externalId: mirrored.externalId,
  githubOwnerId: 991,
  owner: "openclaw",
  repo: "skills",
  slug: "discrawl",
};

describe("skills.sh refresh lifecycle", () => {
  it("updates a mirrored snapshot without requesting a ClawHub scan", () => {
    expect(
      decideMirroredRefresh({
        current: mirrored,
        observed: {
          ...mirrored,
          observationVersion: 11,
          githubCommit: "b".repeat(40),
          sourceContentHash: "content-b",
        },
      }),
    ).toEqual({
      kind: "update",
      scanRequired: false,
      snapshot: {
        ...mirrored,
        observationVersion: 11,
        githubCommit: "b".repeat(40),
        sourceContentHash: "content-b",
      },
    });
  });

  it("treats repeat and stale mirrored observations as idempotent", () => {
    expect(decideMirroredRefresh({ current: mirrored, observed: mirrored })).toEqual({
      kind: "unchanged",
      scanRequired: false,
      snapshot: mirrored,
    });
    expect(
      decideMirroredRefresh({
        current: mirrored,
        observed: { ...mirrored, observationVersion: 9, githubCommit: "9".repeat(40) },
      }),
    ).toEqual({
      kind: "stale",
      scanRequired: false,
      snapshot: mirrored,
    });
    expect(
      decideMirroredRefresh({
        current: mirrored,
        observed: { ...mirrored, githubCommit: "f".repeat(40) },
      }),
    ).toEqual({
      kind: "conflict",
      scanRequired: false,
      snapshot: mirrored,
    });
  });

  it("models deletion, reappearance, and redirects as non-destructive snapshots", () => {
    const deleted = decideMirroredRefresh({
      current: mirrored,
      observed: {
        ...mirrored,
        observationVersion: 11,
        presence: "deleted",
      },
    });
    expect(deleted).toMatchObject({
      kind: "delete",
      scanRequired: false,
      snapshot: { presence: "deleted", sourceContentHash: "content-a" },
    });

    const reappeared = decideMirroredRefresh({
      current: deleted.snapshot,
      observed: {
        ...mirrored,
        observationVersion: 12,
        githubCommit: "c".repeat(40),
        sourceContentHash: "content-c",
      },
    });
    expect(reappeared).toMatchObject({
      kind: "reappear",
      scanRequired: false,
      snapshot: { presence: "present", githubCommit: "c".repeat(40) },
    });

    expect(
      decideMirroredRefresh({
        current: reappeared.snapshot,
        observed: {
          ...reappeared.snapshot,
          observationVersion: 13,
          presence: "redirect",
          redirectExternalId: "openclaw/skills/discrawl-next",
        },
      }),
    ).toMatchObject({
      kind: "redirect",
      scanRequired: false,
      snapshot: { redirectExternalId: "openclaw/skills/discrawl-next" },
    });
  });

  it("reuses an allowed adopted verdict for pointer-only changes", () => {
    const active = {
      ...adoptedIdentity,
      githubPath: mirrored.githubPath,
      githubCommit: mirrored.githubCommit,
      sourceContentHash: mirrored.sourceContentHash,
    };
    const current = {
      ...active,
      githubPath: "skills/discrawl-v2",
      githubCommit: "b".repeat(40),
    };

    expect(resolveAdoptedActiveSource({ current, active })).toEqual(active);
    expect(shouldPromoteAdoptedCandidate({ current, candidate: active, verdict: "clean" })).toBe(
      true,
    );
  });

  it("keeps the prior adopted source active until the changed candidate is allowed", () => {
    const active = {
      ...adoptedIdentity,
      githubPath: mirrored.githubPath,
      githubCommit: mirrored.githubCommit,
      sourceContentHash: mirrored.sourceContentHash,
    };
    const current = {
      ...active,
      githubCommit: "b".repeat(40),
      sourceContentHash: "content-b",
    };

    expect(resolveAdoptedActiveSource({ current, active })).toEqual(active);
    expect(shouldPromoteAdoptedCandidate({ current, candidate: active, verdict: "clean" })).toBe(
      false,
    );
    expect(
      shouldPromoteAdoptedCandidate({
        current,
        candidate: current,
        verdict: "malicious",
      }),
    ).toBe(false);
    expect(
      shouldPromoteAdoptedCandidate({
        current,
        candidate: current,
        verdict: "clean",
      }),
    ).toBe(true);
  });

  it("does not reuse a verdict when the authenticated GitHub content hash changes", () => {
    const active = {
      ...adoptedIdentity,
      githubPath: mirrored.githubPath,
      githubCommit: mirrored.githubCommit,
      githubContentHash: "a".repeat(64),
      sourceContentHash: mirrored.sourceContentHash,
    };
    const current = {
      ...active,
      githubContentHash: "b".repeat(64),
    };

    expect(resolveAdoptedActiveSource({ current, active })).toEqual(active);
    expect(shouldPromoteAdoptedCandidate({ current, candidate: active, verdict: "clean" })).toBe(
      false,
    );
  });

  it("does not reuse an adopted verdict across repository identity changes", () => {
    const active = {
      ...adoptedIdentity,
      githubPath: mirrored.githubPath,
      githubCommit: mirrored.githubCommit,
      githubContentHash: "a".repeat(64),
      sourceContentHash: mirrored.sourceContentHash,
    };
    const current = {
      ...active,
      githubOwnerId: 992,
      owner: "renamed-openclaw",
    };

    expect(resolveAdoptedActiveSource({ current, active })).toEqual(active);
    expect(shouldPromoteAdoptedCandidate({ current, candidate: active, verdict: "clean" })).toBe(
      false,
    );
  });
});
