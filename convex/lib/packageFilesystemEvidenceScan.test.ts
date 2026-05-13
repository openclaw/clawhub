/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  PACKAGE_FILESYSTEM_EVIDENCE_CODES,
  scanPackageFilesystemContent,
  scanPackageFilesystemEvidence,
} from "./packageFilesystemEvidenceScan";

describe("packageFilesystemEvidenceScan", () => {
  it("detects raw fs namespace calls and fs-safe helper usage", () => {
    const findings = scanPackageFilesystemContent(
      "dist/index.js",
      [
        "import fs from 'node:fs';",
        "import { readFileWithinRoot } from '@openclaw/fs-safe';",
        "const raw = fs.readFileSync('/tmp/token', 'utf8');",
        "const safe = await readFileWithinRoot(root, 'token');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      PACKAGE_FILESYSTEM_EVIDENCE_CODES.RAW_FS_USAGE,
      PACKAGE_FILESYSTEM_EVIDENCE_CODES.FS_SAFE_USAGE,
      PACKAGE_FILESYSTEM_EVIDENCE_CODES.RAW_FS_USAGE,
      PACKAGE_FILESYSTEM_EVIDENCE_CODES.FS_SAFE_USAGE,
    ]);
    expect(findings.map((finding) => finding.line)).toEqual([1, 2, 3, 4]);
  });

  it("tracks imported aliases and named raw fs helpers", () => {
    const findings = scanPackageFilesystemContent(
      "src/plugin.ts",
      [
        "import * as filesystem from 'node:fs/promises';",
        "import { readFile as readRaw } from 'node:fs/promises';",
        "const { writeFile: writeRaw } = require('fs');",
        "await filesystem.readFile('/tmp/a');",
        "await readRaw('/tmp/b');",
        "await writeRaw('/tmp/c', data);",
      ].join("\n"),
    );

    expect(
      findings.filter((finding) => finding.code === PACKAGE_FILESYSTEM_EVIDENCE_CODES.RAW_FS_USAGE),
    ).toHaveLength(6);
    expect(findings.map((finding) => finding.evidence)).toContain(
      "await filesystem.readFile('/tmp/a');",
    );
    expect(findings.map((finding) => finding.evidence)).toContain("await readRaw('/tmp/b');");
    expect(findings.map((finding) => finding.evidence)).toContain(
      "await writeRaw('/tmp/c', data);",
    );
  });

  it("ignores comments, string literals, regex literals, and type-only imports", () => {
    const findings = scanPackageFilesystemContent(
      "dist/comments.js",
      [
        "import type { Stats } from 'node:fs';",
        "// import fs from 'node:fs';",
        "const docs = \"fs.readFileSync('/tmp/example') and @openclaw/fs-safe\";",
        "/* const fs = require('node:fs'); */",
        "const rawPattern = /fs\\.readFileSync\\('/;",
        "const fs = makeVirtualFilesystem();",
      ].join("\n"),
    );

    expect(findings).toEqual([]);
  });

  it("returns deterministic bounded evidence across files", () => {
    const summary = scanPackageFilesystemEvidence(
      [
        {
          path: "b.js",
          content:
            "import { readFileWithinRoot } from '@openclaw/fs-safe';\nreadFileWithinRoot(root, 'x');",
        },
        {
          path: "a.js",
          content: [
            "import fs from 'node:fs';",
            "fs.readFileSync('/tmp/a');",
            "fs.writeFileSync('/tmp/b', value);",
          ].join("\n"),
        },
      ],
      { maxEvidenceItems: 1, maxEvidenceChars: 24 },
    );

    expect(summary.scannedFileCount).toBe(2);
    expect(summary.rawFsUsage).toMatchObject({
      reasonCode: PACKAGE_FILESYSTEM_EVIDENCE_CODES.RAW_FS_USAGE,
      totalCount: 3,
      returnedCount: 1,
      omittedCount: 2,
      truncatedEvidenceCount: 1,
    });
    expect(summary.rawFsUsage.evidence.map((finding) => finding.file)).toEqual(["a.js"]);
    expect(summary.rawFsUsage.evidence[0]?.evidence).toBe("import fs from 'node:...");
    expect(summary.fsSafeUsage.totalCount).toBe(2);
  });
});
