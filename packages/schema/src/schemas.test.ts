/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { parseArk } from "./ark";
import { DocsLinks, openClawDocsUrl } from "./docsLinks";
import { getPackageScopeOwnerMismatch, inferPackageNameScope } from "./packages";
import {
  ApiSearchResponseSchema,
  ApiV1SkillInstallResolveResponseSchema,
  ApiV1SkillRescanResponseSchema,
  ApiV1SearchResponseSchema,
  ApiV1SkillVerifyResponseSchema,
  CliPublishRequestSchema,
  CliSkillDeleteRequestSchema,
  CliTelemetryInstallRequestSchema,
  LockfileSchema,
  WellKnownConfigSchema,
} from "./schemas";

describe("clawhub-schema", () => {
  it("parses lockfile records", () => {
    const lock = parseArk(
      LockfileSchema,
      {
        version: 1,
        skills: {
          demo: {
            version: "1.0.0",
            installedAt: 123,
            ownerHandle: "openclaw",
            pinned: true,
            pinReason: "scanner-flagged",
          },
        },
      },
      "Lockfile",
    );
    expect(lock.skills.demo?.version).toBe("1.0.0");
    expect(lock.skills.demo?.ownerHandle).toBe("openclaw");
    expect(lock.skills.demo?.pinned).toBe(true);
    expect(lock.skills.demo?.pinReason).toBe("scanner-flagged");
  });

  it("allows publish payload without tags", () => {
    const payload = parseArk(
      CliPublishRequestSchema,
      {
        slug: "demo",
        displayName: "Demo",
        ownerHandle: "me",
        version: "1.0.0",
        changelog: "",
        files: [{ path: "SKILL.md", size: 1, storageId: "s", sha256: "x" }],
      },
      "Publish payload",
    );
    expect(payload.tags).toBeUndefined();
    expect(payload.files[0]?.path).toBe("SKILL.md");
  });

  it("allows legacy publish payloads without an owner handle", () => {
    const payload = parseArk(
      CliPublishRequestSchema,
      {
        slug: "demo",
        displayName: "Demo",
        version: "1.0.0",
        changelog: "",
        acceptLicenseTerms: true,
        files: [{ path: "SKILL.md", size: 1, storageId: "s", sha256: "x" }],
      },
      "Publish payload",
    );
    expect(payload.ownerHandle).toBeUndefined();
    expect(payload.acceptLicenseTerms).toBe(true);
  });

  it("accepts publish payload with github source", () => {
    const payload = parseArk(
      CliPublishRequestSchema,
      {
        slug: "demo",
        displayName: "Demo",
        ownerHandle: "me",
        version: "1.0.0",
        changelog: "",
        source: {
          kind: "github",
          url: "https://github.com/example/demo",
          repo: "example/demo",
          ref: "main",
          commit: "abc123",
          path: ".",
          importedAt: 123,
        },
        files: [{ path: "SKILL.md", size: 1, storageId: "s", sha256: "x" }],
      },
      "Publish payload",
    );
    expect(payload.source?.repo).toBe("example/demo");
  });

  it("accepts skill install resolver archive and GitHub responses", () => {
    const archive = parseArk(
      ApiV1SkillInstallResolveResponseSchema,
      {
        ok: true,
        slug: "demo",
        installKind: "archive",
        archive: {
          version: "1.0.0",
          downloadUrl: "https://clawhub.ai/api/v1/download?slug=demo&version=1.0.0",
        },
      },
      "Install resolver response",
    );
    expect(archive.ok).toBe(true);
    if (!archive.ok) throw new Error("expected archive install response");
    expect(archive.installKind).toBe("archive");

    const github = parseArk(
      ApiV1SkillInstallResolveResponseSchema,
      {
        ok: true,
        slug: "aiq-deploy",
        installKind: "github",
        github: {
          repo: "NVIDIA/skills",
          path: "skills/aiq-deploy",
          commit: "1".repeat(40),
          contentHash: "hash-aiq-deploy",
          sourceUrl: `https://github.com/NVIDIA/skills/tree/${"1".repeat(40)}/skills/aiq-deploy`,
        },
      },
      "Install resolver response",
    );
    expect(github.ok).toBe(true);
    if (!github.ok) throw new Error("expected GitHub install response");
    expect(github.installKind).toBe("github");

    const blocked = parseArk(
      ApiV1SkillInstallResolveResponseSchema,
      {
        ok: false,
        slug: "aiq-deploy",
        reason: "github_verification_pending",
        message: "Needs verification.",
        status: 423,
      },
      "Install resolver response",
    );
    expect(blocked.ok).toBe(false);
  });

  it("accepts current and legacy install telemetry payloads", () => {
    const current = parseArk(
      CliTelemetryInstallRequestSchema,
      { event: "install", slug: "demo", version: "1.0.0" },
      "Install telemetry",
    );
    const legacy = parseArk(
      CliTelemetryInstallRequestSchema,
      {
        roots: [
          {
            rootId: "root",
            label: "~/skills",
            skills: [{ slug: "demo", version: "1.0.0" }],
          },
        ],
      },
      "Install telemetry",
    );

    expect(current).toMatchObject({ event: "install", slug: "demo" });
    expect(legacy).toMatchObject({ roots: [{ rootId: "root" }] });
  });

  it("accepts hosted and GitHub-backed skill rescan responses", () => {
    const hosted = parseArk(
      ApiV1SkillRescanResponseSchema,
      {
        ok: true,
        slug: "demo",
        version: "1.0.0",
        skillId: "skills:demo",
        skillVersionId: "skillVersions:demo",
        jobId: "securityScanJobs:demo",
        alreadyQueued: false,
      },
      "Hosted skill rescan response",
    );
    if (!("skillVersionId" in hosted)) throw new Error("expected hosted rescan response");
    expect(hosted.skillVersionId).toBe("skillVersions:demo");

    const github = parseArk(
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
    if (!("githubContentHash" in github)) throw new Error("expected GitHub rescan response");
    expect(github.githubContentHash).toBe("content-hash");
  });

  it("accepts publish payloads with an owner handle", () => {
    const payload = parseArk(
      CliPublishRequestSchema,
      {
        slug: "demo",
        displayName: "Demo",
        ownerHandle: "openclaw",
        migrateOwner: true,
        version: "1.0.0",
        changelog: "",
        files: [{ path: "SKILL.md", size: 1, storageId: "s", sha256: "x" }],
      },
      "Publish payload",
    );
    expect(payload.ownerHandle).toBe("openclaw");
    expect(payload.migrateOwner).toBe(true);
  });

  it("reports scoped package names that do not match the selected owner", () => {
    expect(inferPackageNameScope("@openclaw/dronzer")).toBe("openclaw");
    expect(getPackageScopeOwnerMismatch("@openclaw/dronzer", "openclaw")).toBeNull();
    expect(getPackageScopeOwnerMismatch("@openclaw/dronzer", "@VintageAyu")).toEqual({
      scope: "openclaw",
      selectedOwner: "vintageayu",
      suggestedName: "@vintageayu/dronzer",
      message: `Package scope "@openclaw" must match selected owner "@vintageayu". Publish as "@openclaw" or rename this package to "@vintageayu/dronzer". More info: ${DocsLinks.clawhub.packageScopeFaq}`,
    });
  });

  it("builds OpenClaw docs URLs from normalized paths", () => {
    expect(openClawDocsUrl("/clawhub/publishing")).toBe(DocsLinks.clawhub.publishing);
    expect(openClawDocsUrl("clawhub/publishing#package-scope-must-match-selected-owner")).toBe(
      DocsLinks.clawhub.packageScopeFaq,
    );
    expect(openClawDocsUrl("plugins/sdk-setup#package-metadata")).toBe(
      DocsLinks.openclaw.pluginPackageMetadata,
    );
  });

  it("parses well-known config", () => {
    expect(
      parseArk(WellKnownConfigSchema, { registry: "https://example.convex.site" }, "WellKnown"),
    ).toEqual({ registry: "https://example.convex.site" });

    expect(
      parseArk(
        WellKnownConfigSchema,
        { registry: "https://example.convex.site", authBase: "https://clawhub.ai" },
        "WellKnown",
      ),
    ).toEqual({ registry: "https://example.convex.site", authBase: "https://clawhub.ai" });

    expect(
      parseArk(
        WellKnownConfigSchema,
        { apiBase: "https://example.convex.site", minCliVersion: "0.1.0" },
        "WellKnown",
      ),
    ).toEqual({ apiBase: "https://example.convex.site", minCliVersion: "0.1.0" });

    const combined = parseArk(
      WellKnownConfigSchema,
      {
        apiBase: "https://clawhub.ai",
        registry: "https://clawhub.ai",
        authBase: "https://clawhub.ai",
      },
      "WellKnown",
    ) as unknown as Record<string, unknown>;
    expect(combined.apiBase).toBe("https://clawhub.ai");
    expect(combined.registry).toBe("https://clawhub.ai");
  });

  it("throws labeled errors", () => {
    expect(() => parseArk(LockfileSchema, null, "Lockfile")).toThrow(/Lockfile:/);
  });

  it("truncates error messages when there are more than 3 errors", () => {
    const invalidPayload = {
      slug: 123,
      displayName: 456,
      version: 789,
      changelog: true,
      files: "not-an-array",
    };
    expect(() => parseArk(CliPublishRequestSchema, invalidPayload, "Publish")).toThrow("+");
  });

  it("parses search results arrays", () => {
    expect(parseArk(ApiSearchResponseSchema, { results: [] }, "Search")).toEqual({ results: [] });

    const parsed = parseArk(
      ApiSearchResponseSchema,
      {
        results: [
          { slug: "a", ownerHandle: "openclaw", displayName: "A", version: "1.0.0", score: 0.9 },
          { slug: "b", displayName: "B", version: null, score: 0.1 },
        ],
      },
      "Search",
    );
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0]?.slug).toBe("a");
    expect(parsed.results[0]?.ownerHandle).toBe("openclaw");
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

  it("parses delete request payload", () => {
    expect(
      parseArk(CliSkillDeleteRequestSchema, { slug: "demo", reason: "legal hold" }, "Delete"),
    ).toEqual({
      slug: "demo",
      reason: "legal hold",
    });
  });
});
