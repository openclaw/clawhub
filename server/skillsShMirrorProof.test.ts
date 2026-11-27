/* @vitest-environment node */

import { expect, it } from "vitest";
import {
  buildSkillsShMirrorProofSnapshotId,
  parseSkillsShMirrorProofSnapshotId,
} from "./skillsShMirrorProof";

it("keeps legacy snapshots without partition fields readable", () => {
  const snapshot = `skills-sh:proof:${Buffer.from(
    JSON.stringify({
      catalogTotal: 1,
      controlledExternalIds: [" STEIPETE/CLAWDIS/DISCRAWL ", "patrick-erichsen/skills/html"],
    }),
  ).toString("base64url")}`;

  expect(parseSkillsShMirrorProofSnapshotId(snapshot)).toEqual({
    catalogTotal: 1,
    controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
    controlledOverlayExternalIds: [],
    controlledSupplementExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
  });
});

it("round-trips immutable proof source metadata through the run snapshot", () => {
  const evidence = {
    pagination: {
      endpointExhausted: true as const,
      databaseCoverage: "leaderboard-only" as const,
      page0: { page: 0, perPage: 500, total: 9_571, hasMore: true },
      requestedPages: [
        {
          page: 0,
          count: 500,
          hasMore: true,
          identityHash: "page-0",
          contentHash: "content-page-0",
          sourceBytes: 1_000,
          serializedBytes: 750,
        },
      ],
      finalNonemptyPage: {
        page: 19,
        count: 71,
        pagination: { page: 19, perPage: 500, total: 9_571, hasMore: false },
      },
      firstBeyondEndPage: {
        page: 20,
        count: 0,
        pagination: { page: 20, perPage: 500, total: 9_571, hasMore: false },
      },
      uniqueIds: 9_571,
      duplicateIds: 0,
    },
    fields: {
      sampledExternalId: "vercel-labs/skills/find-skills",
      leaderboard: {
        topLevelKeys: ["data", "pagination"],
        paginationKeys: ["hasMore", "page", "perPage", "total"],
        rowKeys: ["id"],
        taxonomyFields: [],
      },
      search: { topLevelKeys: ["data"], rowKeys: ["id"], taxonomyFields: [] },
      detail: { topLevelKeys: ["id"], fileKeys: [], taxonomyFields: [] },
      page: {
        url: "https://www.skills.sh/vercel-labs/skills/find-skills",
        jsonLdDocuments: [],
        taxonomyFields: [],
      },
      rsc: { objectKeys: [], taxonomyFields: [] },
      normalizedUpstreamTaxonomyFields: [],
    },
  };
  const snapshotId = buildSkillsShMirrorProofSnapshotId({
    catalogTotal: 9_571,
    controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
    controlledOverlayExternalIds: ["patrick-erichsen/skills/html"],
    controlledSupplementExternalIds: ["steipete/clawdis/discrawl"],
    evidence,
  });
  expect(parseSkillsShMirrorProofSnapshotId(snapshotId)).toEqual({
    catalogTotal: 9_571,
    controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
    controlledOverlayExternalIds: ["patrick-erichsen/skills/html"],
    controlledSupplementExternalIds: ["steipete/clawdis/discrawl"],
    sourceSnapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    evidence,
  });
  const changedSnapshotId = buildSkillsShMirrorProofSnapshotId({
    catalogTotal: 9_571,
    controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
    controlledOverlayExternalIds: ["patrick-erichsen/skills/html"],
    controlledSupplementExternalIds: ["steipete/clawdis/discrawl"],
    evidence: {
      ...evidence,
      pagination: {
        ...evidence.pagination,
        requestedPages: [
          {
            page: 0,
            count: 500,
            hasMore: true,
            identityHash: "different-page-0",
            contentHash: "different-content-page-0",
          },
        ],
      },
    },
  });
  expect(snapshotId.split(".").slice(0, 2).join(".")).not.toBe(
    changedSnapshotId.split(".").slice(0, 2).join("."),
  );
  const changedTransportSnapshotId = buildSkillsShMirrorProofSnapshotId({
    catalogTotal: 9_571,
    controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
    controlledOverlayExternalIds: ["patrick-erichsen/skills/html"],
    controlledSupplementExternalIds: ["steipete/clawdis/discrawl"],
    evidence: {
      ...evidence,
      pagination: {
        ...evidence.pagination,
        requestedPages: [
          {
            ...evidence.pagination.requestedPages[0]!,
            sourceBytes: 1_024,
          },
        ],
      },
    },
  });
  expect(snapshotId.split(".").slice(0, 2).join(".")).not.toBe(
    changedTransportSnapshotId.split(".").slice(0, 2).join("."),
  );
  const changedPartitionSnapshotId = buildSkillsShMirrorProofSnapshotId({
    catalogTotal: 9_571,
    controlledExternalIds: ["patrick-erichsen/skills/html", "steipete/clawdis/discrawl"],
    controlledOverlayExternalIds: ["steipete/clawdis/discrawl"],
    controlledSupplementExternalIds: ["patrick-erichsen/skills/html"],
    evidence,
  });
  const [changedPayload] = changedPartitionSnapshotId.split(".");
  const [, snapshotHash, encodedEvidence] = snapshotId.split(".");
  expect(() =>
    parseSkillsShMirrorProofSnapshotId([changedPayload, snapshotHash, encodedEvidence].join(".")),
  ).toThrow("skills.sh mirror proof source metadata is invalid");
  const tamperedSnapshotId = snapshotId.replace(/.$/, (value) => (value === "A" ? "B" : "A"));
  expect(() => parseSkillsShMirrorProofSnapshotId(tamperedSnapshotId)).toThrow(
    "skills.sh mirror proof source metadata is invalid",
  );
});
