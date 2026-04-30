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
          files: [{ path: "SKILL.md", size: 12, sha256: "file-sha" }],
          llmAnalysis: {
            status: "suspicious",
            verdict: "suspicious",
            confidence: "high",
            summary: "asks for secrets",
            model: "gpt-test",
            checkedAt: 3,
          },
        },
      ],
      packages: [
        {
          _id: "packages:public",
          displayName: "Demo Package",
          name: "@demo/pkg",
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
          integritySha256: "pkg-sha",
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
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sourceKind)).toEqual(["package", "skill"]);
    expect(rows[0]).toMatchObject({
      sourceKind: "package",
      sourceDocId: "packageReleases:1",
      artifactSha256: "pkg-sha",
      packageChannel: "community",
      sourceRepoHost: "github.com",
      staticScan: { status: "clean" },
    });
    expect(rows[1]).toMatchObject({
      sourceKind: "skill",
      sourceDocId: "skillVersions:1",
      artifactSha256: "skill-sha",
      moderationConsensus: {
        verdict: "suspicious",
        reasonCodes: ["network.exfiltration"],
      },
      llmAnalysis: { model: "gpt-test" },
    });
  });

  it("reads table JSONL files from a Convex export zip", async () => {
    const zip = zipSync({
      "tables/skills.jsonl": strToU8(
        `${JSON.stringify({ _id: "skills:1", displayName: "S", slug: "s" })}\n`,
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
    });
    const directory = await mkdtemp(join(tmpdir(), "clawhub-convex-export-"));
    try {
      const path = join(directory, "export.zip");
      await writeFile(path, Buffer.from(zip));

      await expect(artifactInputsFromConvexExportZip(path)).resolves.toMatchObject([
        { sourceKind: "skill", sourceDocId: "skillVersions:1" },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
