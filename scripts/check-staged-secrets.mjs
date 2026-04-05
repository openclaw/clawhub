#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const ALLOWED_PATH_SUFFIXES = [
  ".example",
  ".sample",
  ".template",
  ".fixtures",
  ".fixture",
  ".test",
  ".spec",
];

const DISALLOWED_PATH_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|p12|pfx|jks|keystore)$/i,
];

const SECRET_PATTERNS = [
  { name: "private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/ },
  {
    name: "GitHub fine-grained token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  },
  { name: "OpenAI API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/ },
  { name: "Stripe live secret", pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/ },
  { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];

function getStagedPaths() {
  const output = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], {
    encoding: "buffer",
  });
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function isAllowedExamplePath(path) {
  return ALLOWED_PATH_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

function isDisallowedPath(path) {
  return DISALLOWED_PATH_PATTERNS.some((pattern) => pattern.test(path)) && !isAllowedExamplePath(path);
}

function getStagedFileContent(path) {
  return execFileSync("git", ["show", `:${path}`], { encoding: "buffer" });
}

function isProbablyBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  return sample.includes(0);
}

function scanContent(path, content) {
  if (content.includes("secret-scan: allow")) return [];
  const findings = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    const match = content.match(pattern);
    if (!match) continue;
    findings.push({
      path,
      reason: `matched ${name}`,
      snippet: match[0].slice(0, 80),
    });
  }
  return findings;
}

const stagedPaths = getStagedPaths();
const findings = [];

for (const path of stagedPaths) {
  if (isDisallowedPath(path)) {
    findings.push({
      path,
      reason: "sensitive file type should not be committed",
      snippet: path,
    });
    continue;
  }

  const contentBuffer = getStagedFileContent(path);
  if (isProbablyBinary(contentBuffer)) continue;
  const content = contentBuffer.toString("utf8");
  findings.push(...scanContent(path, content));
}

if (findings.length === 0) {
  process.exit(0);
}

console.error("Secret scan blocked this commit.");
console.error("Remove the secret, move it to local env/config, or add `secret-scan: allow` next to an intentional test fixture.");
console.error("");
for (const finding of findings) {
  console.error(`- ${finding.path}: ${finding.reason}`);
  console.error(`  ${finding.snippet}`);
}
console.error("");
console.error("If a real secret was staged, rotate it before trying again.");
process.exit(1);
