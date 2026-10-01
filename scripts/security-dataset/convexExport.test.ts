/* @vitest-environment node */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  artifactInputsFromConvexExportTables,
  artifactInputsFromConvexExportZip,
} from "./convexExport";

describe("Convex export dataset ingestion", () => {
  it("maps exported skill versions and package releases to artifact inputs", () => {
    const rows = artifactInputsFromConvexExportTables({
      skills: [
        {
          _id: "skills:1",
          displayName: "Demo Skill",
          slug: "demo-skill",
          ownerPublisherId: "publishers:openclaw",
          ownerUserId: "users:owner",
          capabilityTags: ["filesystem"],
          moderationSourceVersionId: "skillVersions:1",
          moderationVerdict: "suspicious",
          moderationReasonCodes: ["network.exfiltration"],
          moderationSummary: "uses a token",
          moderationEngineVersion: "v2",
          moderationEvaluatedAt: 10,
        },
      ],
      skillVersions: [
        {
          _id: "skillVersions:1",
          skillId: "skills:1",
          version: "1.0.0",
          createdAt: 2,
          sha256hash: "skill-sha",
          files: [
            {
              path: "SKILL.md",
              size: 12,
              sha256: "file-sha",
              content: "Use this skill safely. password=supersecret123",
            },
            {
              path: "scripts/export.py",
              size: 48,
              sha256: "script-sha",
              content: "import json\npassword=supersecret123\n",
              contentType: "text/x-python",
            },
            {
              path: "skill-card.md",
              size: 16,
              sha256: "card-sha",
              content: "Generated card",
              contentType: "text/markdown",
            },
            {
              path: "references/skill-card.md",
              size: 32,
              sha256: "nested-card-sha",
              content: "Author-authored card note",
              contentType: "text/markdown",
            },
            {
              path: "docs/SKILL.md",
              size: 36,
              sha256: "nested-skill-sha",
              content: "Nested authored skill reference",
              contentType: "text/markdown",
            },
          ],
          llmAnalysis: {
            status: "suspicious",
            verdict: "suspicious",
            confidence: "high",
            summary: "asks for secrets",
            agenticRiskFindings: [
              {
                categoryId: "ASI04",
                categoryLabel: "Tool and permission overreach",
                riskBucket: "permission_boundary",
                status: "concern",
                severity: "high",
                confidence: "high",
                evidence: {
                  path: "SKILL.md",
                  snippet: "Use token=supersecret123",
                  explanation: "References sensitive token handling.",
                },
                userImpact: "Could expose credentials.",
                recommendation: "Require least-privilege credentials.",
              },
            ],
            model: "gpt-test",
            checkedAt: 3,
          },
          skillSpectorAnalysis: {
            status: "suspicious",
            score: 55,
            severity: "HIGH",
            recommendation: "DO_NOT_INSTALL",
            issueCount: 1,
            scannerVersion: "skillspector-v2.0.0",
            summary: "found deceptive metadata",
            checkedAt: 6,
            issues: [
              {
                issueId: "SDI-1",
                severity: "HIGH",
                confidence: 0.98,
                explanation: "The skill body does not match the declaration.",
              },
            ],
          },
        },
      ],
      packages: [
        {
          _id: "packages:public",
          displayName: "Demo Package",
          name: "@demo/pkg",
          ownerUserId: "users:owner",
          channel: "community",
          family: "code-plugin",
          sourceRepo: "git@github.com:demo/pkg.git",
          executesCode: true,
          capabilityTags: ["executes-code"],
        },
        {
          _id: "packages:private",
          displayName: "Private Package",
          name: "@demo/private",
          ownerUserId: "users:owner",
          channel: "private",
          family: "code-plugin",
        },
      ],
      packageReleases: [
        {
          _id: "packageReleases:1",
          packageId: "packages:public",
          version: "2.0.0",
          createdAt: 1,
          artifactKind: "npm-pack",
          clawpackSha256: "pkg-tgz-sha",
          sha256hash: "pkg-zip-sha",
          integritySha256: "pkg-file-set-sha",
          files: [{ path: "package/index.js", size: 24, sha256: "pkg-file-sha" }],
          staticScan: {
            status: "clean",
            reasonCodes: [],
            findings: [],
            summary: "ok",
            engineVersion: "static-v1",
            checkedAt: 4,
          },
        },
        {
          _id: "packageReleases:private",
          packageId: "packages:private",
          version: "1.0.0",
          createdAt: 5,
          integritySha256: "private-sha",
          files: [],
        },
      ],
      users: [{ _id: "users:owner", handle: "alice" }],
      publishers: [{ _id: "publishers:openclaw", handle: "openclaw" }],
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sourceKind)).toEqual(["package", "skill"]);
    expect(rows[0]).toMatchObject({
      sourceKind: "package",
      sourceDocId: "packageReleases:1",
      artifactSha256: "pkg-tgz-sha",
      publicOwnerHandle: "alice",
      packageChannel: "community",
      sourceRepoHost: "github.com",
      staticScan: { status: "clean" },
    });
    expect(rows[1]).toMatchObject({
      sourceKind: "skill",
      sourceDocId: "skillVersions:1",
      artifactSha256: "skill-sha",
      publicOwnerHandle: "openclaw",
      publicSlug: "demo-skill",
      moderationConsensus: {
        verdict: "suspicious",
        reasonCodes: ["network.exfiltration"],
      },
      llmAnalysis: { model: "gpt-test" },
      skillSpectorAnalysis: {
        status: "suspicious",
        score: 55,
        issues: [{ issueId: "SDI-1" }],
      },
      skillMdContentRedacted: "Use this skill safely. [REDACTED_SECRET]",
      bundleFilesRedacted: [
        {
          path: "SKILL.md",
          content: "Use this skill safely. [REDACTED_SECRET]",
        },
        {
          path: "scripts/export.py",
          content: "import json\n[REDACTED_SECRET]\n",
        },
        {
          path: "references/skill-card.md",
          content: "Author-authored card note",
        },
        {
          path: "docs/SKILL.md",
          content: "Nested authored skill reference",
        },
      ],
    });
    expect(rows[1]?.llmAnalysis?.agenticRiskFindings).toMatchObject([
      {
        categoryId: "ASI04",
        riskBucket: "permission_boundary",
        status: "concern",
        severity: "high",
        evidence: {
          path: "SKILL.md",
        },
      },
    ]);
  });

  it("reads table JSONL files from a Convex export zip", async () => {
    const zip = zipSync({
      "tables/skills.jsonl": strToU8(
        `${JSON.stringify({
          _id: "skills:1",
          displayName: "S",
          slug: "s",
          ownerUserId: "users:owner",
        })}\n`,
      ),
      "tables/skillVersions.jsonl": strToU8(
        `${JSON.stringify({
          _id: "skillVersions:1",
          skillId: "skills:1",
          version: "1.0.0",
          createdAt: 1,
          files: [],
        })}\n`,
      ),
      "tables/packages.jsonl": strToU8(""),
      "tables/packageReleases.jsonl": strToU8(""),
      "tables/users.jsonl": strToU8(`${JSON.stringify({ _id: "users:owner", handle: "owner" })}\n`),
    });
    const directory = await mkdtemp(join(tmpdir(), "clawhub-convex-export-"));
    try {
      const path = join(directory, "export.zip");
      await writeFile(path, Buffer.from(zip));

      await expect(artifactInputsFromConvexExportZip(path)).resolves.toMatchObject([
        { sourceKind: "skill", sourceDocId: "skillVersions:1", publicOwnerHandle: "owner" },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("treats root skills.md as primary skill content", () => {
    const rows = artifactInputsFromConvexExportTables({
      skills: [
        {
          _id: "skills:1",
          displayName: "Plural Readme Skill",
          slug: "plural-readme-skill",
          ownerUserId: "users:owner",
        },
      ],
      skillVersions: [
        {
          _id: "skillVersions:1",
          skillId: "skills:1",
          version: "1.0.0",
          createdAt: 1,
          files: [
            {
              path: "docs/skills.md",
              size: 24,
              sha256: "nested-skills-sha",
              content: "Nested authored plural readme",
            },
            {
              path: "skills.md",
              size: 12,
              sha256: "skills-sha",
              content: "Primary readme token=supersecret123",
            },
          ],
        },
      ],
      packages: [],
      packageReleases: [],
      users: [{ _id: "users:owner", handle: "owner" }],
    });

    expect(rows[0]).toMatchObject({
      skillMdContentRedacted: "Primary readme [REDACTED_SECRET]",
      bundleFilesRedacted: [
        {
          path: "docs/skills.md",
          content: "Nested authored plural readme",
        },
        {
          path: "skills.md",
          content: "Primary readme [REDACTED_SECRET]",
        },
      ],
    });
  });

  it("ignores inactive owner handles from Convex export tables", () => {
    const rows = artifactInputsFromConvexExportTables({
      skills: [
        {
          _id: "skills:1",
          displayName: "Demo Skill",
          slug: "demo-skill",
          ownerPublisherId: "publishers:inactive",
          ownerUserId: "users:owner",
        },
        {
          _id: "skills:2",
          displayName: "Deleted Owner Skill",
          slug: "deleted-owner-skill",
          ownerUserId: "users:deleted",
        },
        {
          _id: "skills:3",
          displayName: "Linked Personal Publisher Skill",
          slug: "linked-personal-publisher-skill",
          ownerUserId: "users:linked",
        },
      ],
      skillVersions: [
        {
          _id: "skillVersions:1",
          skillId: "skills:1",
          version: "1.0.0",
          createdAt: 1,
          files: [],
        },
        {
          _id: "skillVersions:2",
          skillId: "skills:2",
          version: "1.0.0",
          createdAt: 2,
          files: [],
        },
        {
          _id: "skillVersions:3",
          skillId: "skills:3",
          version: "1.0.0",
          createdAt: 3,
          files: [],
        },
      ],
      packages: [],
      packageReleases: [],
      users: [
        {
          _id: "users:owner",
          handle: "fallback-owner",
          personalPublisherId: "publishers:personal",
        },
        { _id: "users:deleted", handle: "deleted-owner", deletedAt: 123 },
        { _id: "users:linked", handle: "legacy-user" },
      ],
      publishers: [
        { _id: "publishers:inactive", handle: "inactive-org", deactivatedAt: 456 },
        { _id: "publishers:personal", handle: "personal-owner" },
        { _id: "publishers:linked", handle: "linked-personal", linkedUserId: "users:linked" },
      ],
    });

    expect(rows).toMatchObject([
      { sourceDocId: "skillVersions:1", publicOwnerHandle: "personal-owner" },
      { sourceDocId: "skillVersions:2", publicOwnerHandle: null },
      { sourceDocId: "skillVersions:3", publicOwnerHandle: "linked-personal" },
    ]);
  });
});
