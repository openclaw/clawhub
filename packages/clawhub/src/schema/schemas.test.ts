/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { parseArk } from "./ark";
import { ApiV1PackagePublishResponseSchema } from "./packages";
import {
  ApiV1OfficialPublisherListResponseSchema,
  ApiV1SearchResponseSchema,
  ApiV1SkillRescanResponseSchema,
  ApiV1SkillVerifyResponseSchema,
  ClawdisSkillMetadataSchema,
} from "./schemas";

describe("packages/clawhub skill metadata schema", () => {
  it("preserves optional env var declarations", () => {
    const parsed = parseArk(
      ClawdisSkillMetadataSchema,
      {
        envVars: [
          { name: "TODOIST_API_KEY", required: true, description: "API token" },
          { name: "TODOIST_PROJECT_ID", required: false, description: "Default project" },
        ],
      },
      "Skill metadata",
    );

    expect(parsed.envVars?.[1]).toEqual({
      name: "TODOIST_PROJECT_ID",
      required: false,
      description: "Default project",
    });
  });

  it("parses v1 search owner metadata", () => {
    const parsed = parseArk(
      ApiV1SearchResponseSchema,
      {
        results: [
          {
            slug: "demo",
            displayName: "Demo",
            summary: null,
            version: "1.0.0",
            score: 1,
            downloads: 42,
            ownerHandle: "openclaw",
            owner: {
              handle: "openclaw",
              displayName: "OpenClaw",
              image: null,
            },
          },
        ],
      },
      "Search",
    );

    expect(parsed.results[0]?.ownerHandle).toBe("openclaw");
    expect(parsed.results[0]?.downloads).toBe(42);
    expect(parsed.results[0]?.owner?.displayName).toBe("OpenClaw");
  });

  it("parses pending package publish responses with legacy IDs", () => {
    const parsed = parseArk(
      ApiV1PackagePublishResponseSchema,
      {
        ok: true,
        packageId: "packages:demo",
        releaseId: "packageReleases:demo",
        publicationStatus: "pending",
        attemptId: "publishAttempts:demo",
      },
      "Package publish response",
    );

    expect(parsed.releaseId).toBe("packageReleases:demo");
    expect(parsed.publicationStatus).toBe("pending");
    expect(parsed.attemptId).toBe("publishAttempts:demo");
  });

  it("parses flattened skill verification envelopes", () => {
    const parsed = parseArk(
      ApiV1SkillVerifyResponseSchema,
      {
        schema: "clawhub.skill.verify.v1",
        ok: true,
        decision: "pass",
        reasons: [],
        slug: "demo",
        displayName: "Demo",
        pageUrl: "https://clawhub.ai/openclaw/skills/demo",
        publisherHandle: "openclaw",
        publisherDisplayName: "OpenClaw",
        publisherProfileUrl: "https://clawhub.ai/openclaw",
        version: "1.0.0",
        resolvedFrom: "latest",
        tag: null,
        createdAt: 1,
        card: { available: true },
        artifact: { sourceFingerprint: "source", bundleFingerprints: [], files: [] },
        provenance: { source: "unavailable" },
        security: { status: "clean", passed: true },
        signature: { status: "unsigned" },
      },
      "Verify",
    );

    expect(parsed.slug).toBe("demo");
    expect(parsed.version).toBe("1.0.0");
  });

  it("parses GitHub-backed skill rescan responses", () => {
    const parsed = parseArk(
      ApiV1SkillRescanResponseSchema,
      {
        ok: true,
        slug: "github-demo",
        version: "abc123",
        skillId: "skills:github-demo",
        githubContentHash: "content-hash",
        scheduled: true,
        alreadyQueued: false,
      },
      "GitHub skill rescan response",
    );

    if (!("githubContentHash" in parsed)) throw new Error("expected GitHub rescan response");
    expect(parsed.githubContentHash).toBe("content-hash");
  });

  it("parses optional official publisher state facts", () => {
    const parsed = parseArk(
      ApiV1OfficialPublisherListResponseSchema,
      {
        ok: true,
        items: [
          {
            officialPublisherId: "officialPublishers:openclaw",
            publisherId: "publishers:openclaw",
            handle: "openclaw",
            displayName: "OpenClaw",
            kind: "org",
            active: true,
            state: {
              claimState: "claimed",
              officialState: "official",
              restrictionState: "active",
            },
            reason: "platform-owned publisher",
            createdByUserId: "users:admin",
            createdByHandle: "patrick-erichsen-2",
            createdAt: 1,
            updatedAt: 1,
          },
          {
            officialPublisherId: "officialPublishers:legacy",
            publisherId: "publishers:legacy",
            handle: null,
            displayName: null,
            kind: null,
            active: false,
            reason: null,
            createdByUserId: null,
            createdByHandle: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      "Official publishers",
    );

    expect(parsed.items[0]?.state?.officialState).toBe("official");
    expect(parsed.items[1]?.state).toBeUndefined();
  });
});
