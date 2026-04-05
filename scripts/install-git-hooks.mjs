#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function gitPath(path) {
  return execFileSync("git", ["rev-parse", "--git-path", path], { encoding: "utf8" }).trim();
}

let preCommitPath;
try {
  preCommitPath = gitPath("hooks/pre-commit");
} catch {
  process.exit(0);
}

const hooksDir = dirname(preCommitPath);
mkdirSync(hooksDir, { recursive: true });

const helperPath = gitPath("hooks/pre-commit-secret-scan");
const helper = `#!/bin/sh
set -eu

bun scripts/check-staged-secrets.mjs
`;
writeFileSync(helperPath, helper, "utf8");
chmodSync(helperPath, 0o755);

const hookSnippet = `
# ClawHub secret scan
"$(git rev-parse --git-path hooks/pre-commit-secret-scan)"
`;

if (!existsSync(preCommitPath)) {
  writeFileSync(preCommitPath, `#!/bin/sh
set -eu${hookSnippet}
`, "utf8");
  chmodSync(preCommitPath, 0o755);
  process.exit(0);
}

const existing = readFileSync(preCommitPath, "utf8");
if (existing.includes("pre-commit-secret-scan")) {
  process.exit(0);
}

writeFileSync(preCommitPath, `${existing.trimEnd()}${hookSnippet}
`, "utf8");
chmodSync(preCommitPath, 0o755);
