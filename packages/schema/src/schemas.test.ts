/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { parseArk } from "./ark";
import { MAX_CLAWSCAN_NOTE_CHARS, normalizeClawScanNote } from "./clawScanNote";
import { DocsLinks, openClawDocsUrl } from "./docsLinks";
import { getPackageScopeOwnerMismatch, inferPackageNameScope } from "./packages";
import {
  ApiV1SearchResponseSchema,
  ApiSearchResponseSchema,
  CliPublishRequestSchema,
  CliSkillDeleteRequestSchema,
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
            pinned: true,
            pinReason: "scanner-flagged",
          },
        },
      },
      "Lockfile",
    );
    expect(lock.skills.demo?.version).toBe("1.0.0");
    expect(lock.skills.demo?.pinned).toBe(true);
    expect(lock.skills.demo?.pinReason).toBe("scanner-flagged");
  });

  it("allows publish payload without tags", () => {
    const payload = parseArk(
      CliPublishRequestSchema,
      {
        slug: "demo",
        displayName: "Demo",
        version: "1.0.0",
        changelog: "",
        files: [{ path: "SKILL.md", size: 1, storageId: "s", sha256: "x" }],
      },
      "Publish payload",
    );
    expect(payload.tags).toBeUndefined();
    expect(payload.files[0]?.path).toBe("SKILL.md");
  });

  it("accepts publish payload with github source", () => {
    const payload = parseArk(
      CliPublishRequestSchema,
      {
        slug: "demo",
        displayName: "Demo",
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

  it("normalizes ClawScan notes at the shared input boundary", () => {
    expect(normalizeClawScanNote("  reviewer context  ")).toBe("reviewer context");
    expect(normalizeClawScanNote("   ")).toBeUndefined();
    expect(() => normalizeClawScanNote("x".repeat(MAX_CLAWSCAN_NOTE_CHARS + 1))).toThrow(
      `ClawScan note must be at most ${MAX_CLAWSCAN_NOTE_CHARS} characters.`,
    );
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
          { slug: "a", displayName: "A", version: "1.0.0", score: 0.9 },
          { slug: "b", displayName: "B", version: null, score: 0.1 },
        ],
      },
      "Search",
    );
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0]?.slug).toBe("a");
  });

  it("parses v1 search owner metadata while accepting older result shapes", async () => {
    const parsed = parseArk(
      ApiV1SearchResponseSchema,
      {
        results: [
          {
            slug: "weather",
            displayName: "Weather",
            version: "1.0.0",
            score: 4.553,
            ownerHandle: "steipete",
            owner: {
              handle: "steipete",
              displayName: "Peter Steinberger",
              image: null,
            },
          },
          {
            slug: "weather-1-0-0",
            displayName: "Weather 1.0.0",
            version: null,
            score: 3.125,
          },
        ],
      },
      "V1 search",
    );

    expect(parsed.results[0]?.ownerHandle).toBe("steipete");
    expect(parsed.results[0]?.owner?.handle).toBe("steipete");
    expect(parsed.results[1]?.ownerHandle).toBeUndefined();
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
