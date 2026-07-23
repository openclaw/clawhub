import { describe, expect, it } from "vitest";
import { classifyGitHubSkillSyncPreviewItem } from "./githubSkillSyncSettings";

const discovered = {
  slug: "html",
  displayName: "HTML",
  path: "skills/html",
  contentHash: "content-hash",
};

describe("classifyGitHubSkillSyncPreviewItem", () => {
  it("classifies a repository skill with no destination as a new destination", () => {
    expect(
      classifyGitHubSkillSyncPreviewItem({
        discovered,
        destination: { kind: "none" },
      }),
    ).toMatchObject({
      classification: "new-destination",
      eligible: true,
      destination: null,
    });
  });

  it("classifies a controlled Hosted Skill as a replacement", () => {
    expect(
      classifyGitHubSkillSyncPreviewItem({
        discovered,
        destination: {
          kind: "owned",
          skillId: "skills:html",
          ownerPublisherId: "publishers:patrick",
          ownerHandle: "patrick",
          slug: "html",
          displayName: "HTML",
          installKind: "hosted",
        },
      }),
    ).toMatchObject({
      classification: "replacement",
      eligible: true,
      destination: {
        skillId: "skills:html",
        ownerHandle: "patrick",
      },
    });
  });

  it("classifies unavailable and conflicting destinations without allowing activation", () => {
    expect(
      classifyGitHubSkillSyncPreviewItem({
        discovered: { ...discovered, slug: "missing" },
        destination: {
          kind: "owned",
          skillId: "skills:missing",
          ownerPublisherId: "publishers:patrick",
          ownerHandle: "patrick",
          slug: "missing",
          displayName: "Missing",
          installKind: "hosted",
          unavailableReason: "destination-soft-deleted",
        },
      }),
    ).toMatchObject({
      classification: "unavailable",
      eligible: false,
      reason: "destination-soft-deleted",
    });

    expect(
      classifyGitHubSkillSyncPreviewItem({
        discovered: { ...discovered, slug: "claimed" },
        destination: {
          kind: "source-conflict",
          ownerPublisherId: "publishers:other",
          ownerHandle: "other",
        },
      }),
    ).toMatchObject({
      classification: "ownership-conflict",
      eligible: false,
      reason: "repository-owned-by-another-publisher",
    });
  });
});
