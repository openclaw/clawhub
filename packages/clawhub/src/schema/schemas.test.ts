/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { parseArk } from "./ark";
import { ApiV1PackagePublishResponseSchema } from "./packages";
import {
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

  it("preserves canonical mixed search order and source/trust metadata", () => {
    const parsed = parseArk(
      ApiV1SearchResponseSchema,
      {
        results: [
          {
            id: "skills-sh:acme/skills/calendar",
            source: "skills-sh",
            slug: "calendar",
            displayName: "Calendar",
            summary: "Calendar workflows",
            score: 6_110,
            canonicalUrl: "/skills-sh/acme/skills/calendar",
            official: false,
            featured: false,
            links: {
              canonical: "/skills-sh/acme/skills/calendar",
              source: "https://skills.sh/acme/skills/calendar",
            },
            publisher: null,
            install: {
              kind: "skills-sh",
              reference: "skills-sh/acme/skills/calendar",
              sourceUrl: "https://skills.sh/acme/skills/calendar",
            },
            sourceIdentity: {
              id: "acme/skills/calendar",
              owner: "acme",
              repo: "skills",
              host: null,
              lifetimeInstalls: 99_000,
            },
            trust: {
              visibility: "public",
              installability: "installable",
              clawHubVerdict: null,
              upstreamScanners: { socket: { status: "pass" } },
              sourceFreshness: "observed-only",
            },
            metrics: {
              rolling60DayInstalls: null,
              bookmarks: null,
              updatedAt: 10,
            },
          },
          {
            id: "clawhub:skills:calendar",
            source: "clawhub",
            slug: "calendar-native",
            score: 5_095,
          },
        ],
      },
      "Search",
    );

    expect(parsed.results.map((result) => result.id)).toEqual([
      "skills-sh:acme/skills/calendar",
      "clawhub:skills:calendar",
    ]);
    expect(parsed.results[0]?.install?.reference).toBe("skills-sh/acme/skills/calendar");
    expect(parsed.results[0]?.trust?.sourceFreshness).toBe("observed-only");
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
});
