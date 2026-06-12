#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "dist", "docs-site");
const sourceMetaPath = path.join(root, ".openclaw-sync", "source.json");
const defaultRepoUrl = "https://github.com/openclaw/openclaw";
const maxFileBytes = 180_000;
const maxSearchChars = 600;
const maxIndexBytes = 18 * 1024 * 1024;

const includeExts = new Set([
  ".cjs",
  ".css",
  ".go",
  ".gql",
  ".graphql",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".kt",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".yaml",
  ".yml",
]);

const excludedPrefixes = [".git/", ".github/codeql/", "docs/", "node_modules/", "vendor/"];

const excludedParts = new Set([
  "__fixtures__",
  "__snapshots__",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "snapshots",
]);

const excludedFiles = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);

fs.mkdirSync(outDir, { recursive: true });

const sourceMeta = readJson(sourceMetaPath) ?? {};
const sourceDir = resolveSourceDir();
const outPath = path.join(outDir, "source-index.jsonl");
const metaPath = path.join(outDir, "source-index-meta.json");

if (!sourceDir) {
  if (process.env.DOCS_SOURCE_REPO_DIR) {
    throw new Error(`DOCS_SOURCE_REPO_DIR not found: ${process.env.DOCS_SOURCE_REPO_DIR}`);
  }
  writeEmptyIndex("source checkout not found");
  process.exit(0);
}

const repoUrl = normalizeRepoUrl(
  process.env.DOCS_SOURCE_REPO_URL ?? repoUrlFromGit(sourceDir) ?? defaultRepoUrl,
);
const sourceSha =
  process.env.DOCS_SOURCE_SHA ?? sourceMeta.sha ?? git(sourceDir, ["rev-parse", "HEAD"]);
const files = git(sourceDir, ["ls-files"])
  .split("\n")
  .filter(Boolean)
  .filter(shouldIndexFile)
  .sort(compareFilePriority);

let bytes = 0;
let recordCount = 0;
let skippedLarge = 0;
let skippedBudget = 0;
const output = fs.createWriteStream(outPath, { encoding: "utf8" });

for (const rel of files) {
  const full = path.join(sourceDir, rel);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    continue;
  }
  if (!stat.isFile()) continue;
  if (stat.size > maxFileBytes) {
    skippedLarge += 1;
    continue;
  }
  const text = fs.readFileSync(full, "utf8");
  if (text.includes("\0") || !text.trim()) continue;
  const search = searchTextForFile(rel, text);
  if (!search) continue;
  const record = {
    path: rel,
    url: `${repoUrl}/blob/${sourceSha}/${encodeURI(rel)}`,
    rawUrl: rawUrlFor(repoUrl, sourceSha, rel),
    commit: `${repoUrl}/commit/${sourceSha}`,
    search,
  };
  const line = `${JSON.stringify(record)}\n`;
  const lineBytes = Buffer.byteLength(line);
  if (bytes + lineBytes > maxIndexBytes) {
    skippedBudget += 1;
    continue;
  }
  output.write(line);
  bytes += lineBytes;
  recordCount += 1;
}

await new Promise((resolve) => output.end(resolve));

const meta = {
  repository: sourceMeta.repository ?? "openclaw/openclaw",
  repoUrl,
  sha: sourceSha,
  sourceDir: path.relative(root, sourceDir),
  records: recordCount,
  bytes,
  filesConsidered: files.length,
  skippedLarge,
  skippedBudget,
};
fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
console.log(
  `indexed ${recordCount} source files from ${files.length} files (${Math.round(bytes / 1024)} KiB)`,
);
if (skippedLarge || skippedBudget) {
  console.log(`source index skips: large=${skippedLarge} budget=${skippedBudget}`);
}

function resolveSourceDir() {
  const candidates = [
    process.env.DOCS_SOURCE_REPO_DIR,
    path.join(root, "source"),
    path.join(root, "..", "openclaw-source"),
    path.join(root, "..", "openclaw"),
    path.join(root, "..", "clawdbot5"),
    path.join(root, "..", "clawdbot"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const full = path.resolve(candidate);
    if (!fs.existsSync(path.join(full, ".git"))) continue;
    try {
      const files = git(full, ["ls-files", "src"]).split("\n").filter(Boolean);
      if (files.length > 100) return full;
    } catch {
      // Try the next candidate.
    }
  }
}

function shouldIndexFile(rel) {
  if (excludedFiles.has(path.basename(rel))) return false;
  if (["AGENTS.md", "CLAUDE.md"].includes(path.basename(rel))) return false;
  if (excludedPrefixes.some((prefix) => rel.startsWith(prefix))) return false;
  if (rel.split("/").some((part) => excludedParts.has(part))) return false;
  const ext = path.extname(rel);
  if (includeExts.has(ext)) return true;
  return (
    !rel.includes("/") &&
    [
      "Dockerfile",
      "Makefile",
      "README.md",
      "CHANGELOG.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "VISION.md",
    ].includes(path.basename(rel))
  );
}

function compareFilePriority(a, b) {
  return filePriority(a) - filePriority(b) || a.localeCompare(b);
}

function filePriority(rel) {
  if (/^(src|extensions|packages)\//.test(rel)) return 0;
  if (/^(apps|ui|scripts|skills|config)\//.test(rel)) return 1;
  if (/^\.github\//.test(rel)) return 2;
  if (/^(qa|security)\//.test(rel)) return 3;
  if (/^(test|patches)\//.test(rel)) return 4;
  return rel.includes("/") ? 5 : 1;
}

function searchTextForFile(rel, text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const chosen = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (i < 40 || isSearchSignal(line)) chosen.push(`${i + 1}: ${line}`);
    if (chosen.join("\n").length >= maxSearchChars) break;
  }
  return chosen.join("\n").slice(0, maxSearchChars).trim();
}

function isSearchSignal(line) {
  return /^(#{1,4}\s|import\s|export\s|module\.exports|async\s+function\s|function\s|class\s|interface\s|type\s|enum\s|const\s|let\s|var\s|def\s|class\s|func\s|struct\s|protocol\s|extension\s|describe\s*\(|it\s*\(|test\s*\(|name:\s|command:\s|on:\s|jobs:\s)/.test(
    line,
  );
}

function rawUrlFor(repoUrl, sha, rel) {
  const match = repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (!match) return "";
  return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${sha}/${encodeURI(rel)}`;
}

function languageForPath(rel) {
  const ext = path.extname(rel).replace(/^\./, "");
  if (ext) return ext;
  if (path.basename(rel) === "Dockerfile") return "dockerfile";
  return "text";
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeEmptyIndex(reason) {
  fs.writeFileSync(outPath, "", "utf8");
  fs.writeFileSync(metaPath, `${JSON.stringify({ records: 0, reason }, null, 2)}\n`, "utf8");
  console.warn(`source index skipped: ${reason}`);
}

function repoUrlFromGit(dir) {
  try {
    const remotes = git(dir, ["remote", "-v"]).split("\n");
    const origin =
      remotes.find((line) => line.startsWith("origin\t") && line.includes("(fetch)")) ??
      remotes.find((line) => line.includes("(fetch)"));
    return origin?.split(/\s+/)[1];
  } catch {
    return "";
  }
}

function normalizeRepoUrl(value) {
  return String(value)
    .replace(/\.git$/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/\/$/, "");
}

function git(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}
