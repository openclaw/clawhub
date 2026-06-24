import { describe, expect, it } from "vitest";
import {
  DEFAULT_PUBLIC_CORPUS_FIXTURE,
  parseCorpusJsonl,
  validateCorpusRows,
  type PublicCorpusRow,
} from "./validate";

const skillRow: PublicCorpusRow = {
  kind: "skill",
  slug: "demo-skill",
  displayName: "Demo Skill",
  version: "1.0.0",
  skillMd: "---\nname: demo-skill\ndescription: Demo skill\n---\n# Demo Skill",
  createdAt: 1770000000000,
};

const pluginRow: PublicCorpusRow = {
  kind: "plugin",
  name: "@demo/plugin",
  displayName: "Demo Plugin",
  version: "1.0.0",
  readme: "# Demo Plugin\n\nRuntime plugin for local fixture testing.",
  family: "code-plugin",
  channel: "community",
  createdAt: 1770000000000,
};

describe("public corpus fixture validation", () => {
  it("accepts clean skill and plugin rows", () => {
    expect(validateCorpusRows([skillRow, pluginRow])).toEqual({
      ok: true,
      rowCount: 2,
      skillCount: 1,
      pluginCount: 1,
      findings: [],
    });
  });

  it("rejects owner identity fields and raw Convex ids", () => {
    const row = {
      ...skillRow,
      ownerHandle: "real-user",
      sourceDocId: "skillVersions:abc123",
    } as unknown as PublicCorpusRow;

    const result = validateCorpusRows([row]);

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.reason)).toContain("disallowed_field");
    expect(result.findings.map((finding) => finding.reason)).toContain("raw_convex_id");
  });

  it("rejects duplicate slugs within each artifact kind", () => {
    const result = validateCorpusRows([skillRow, { ...skillRow, displayName: "Duplicate" }]);

    expect(result.ok).toBe(false);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ reason: "duplicate_slug", value: "skill:demo-skill" }),
    );
  });

  it("rejects invalid plugin categories and topics", () => {
    const result = validateCorpusRows([
      {
        ...pluginRow,
        categories: ["not-a-category"],
        topics: ["Official"],
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        reason: "invalid_catalog_metadata",
        field: "categories",
      }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        reason: "invalid_catalog_metadata",
        field: "topics",
      }),
    );
  });

  it("rejects empty content and secret-like text", () => {
    const result = validateCorpusRows([
      { ...skillRow, slug: "empty", skillMd: "" },
      {
        ...skillRow,
        slug: "secret",
        skillMd: `# Secret\nOPENAI_API_KEY=${"sk"}-${"proj"}-abc12345678901234567890`,
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.reason)).toContain("empty_skill_text");
    expect(result.findings.map((finding) => finding.reason)).toContain("secret_like_text");
  });

  it("rejects raw local absolute paths but allows redacted path placeholders", () => {
    const rawLocalPath = ["", "Users", "alice", "project", "secret.txt"].join("/");
    const result = validateCorpusRows([
      { ...skillRow, slug: "local-path", skillMd: `# Path\n${rawLocalPath}` },
      {
        ...skillRow,
        slug: "redacted-path",
        skillMd: "# Path\n/Users/[REDACTED_USER]/project/example.txt",
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ reason: "local_path", field: "skillMd" }),
    );
    expect(result.findings).not.toContainEqual(
      expect.objectContaining({ line: 2, reason: "local_path" }),
    );
  });

  it("parses newline-delimited corpus rows", () => {
    expect(
      parseCorpusJsonl(`${JSON.stringify(skillRow)}\n\n${JSON.stringify(pluginRow)}\n`),
    ).toEqual([skillRow, pluginRow]);
  });

  it("documents the committed fixture path", () => {
    expect(DEFAULT_PUBLIC_CORPUS_FIXTURE).toBe("fixtures/public-corpus/corpus.jsonl");
  });
});
