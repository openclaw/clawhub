#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "../..");
const manifestRel = "scripts/docs-sync/openclaw-plugin-docs.json";
const reportRootRel = "docs/.openclaw-sync";
const pendingRel = `${reportRootRel}/pending.json`;

export function loadSyncManifest({ repoRoot = defaultRepoRoot } = {}) {
  const file = path.join(repoRoot, manifestRel);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));

  if (manifest.schemaVersion !== 1) {
    throw new Error(`${manifestRel} must use schemaVersion 1`);
  }
  if (!manifest.upstream?.repository || !manifest.upstream?.branch) {
    throw new Error(`${manifestRel} must declare upstream.repository and upstream.branch`);
  }
  if (!manifest.upstream.lastSyncedCommit) {
    throw new Error(`${manifestRel} must declare upstream.lastSyncedCommit`);
  }

  manifest.mirrors = normalizeMirrors(manifest.mirrors);
  manifest.watchOnly = normalizePaths(manifest.watchOnly, "watchOnly");
  manifest.clawhubOwned = normalizePaths(manifest.clawhubOwned, "clawhubOwned");
  manifest.flavourChecks = normalizeFlavourChecks(manifest.flavourChecks);

  const mirroredTargets = new Set(manifest.mirrors.map((entry) => entry.target));
  for (const owned of manifest.clawhubOwned) {
    if (mirroredTargets.has(owned)) {
      throw new Error(`${owned} is both mirrored and ClawHub-owned`);
    }
  }
  for (const check of manifest.flavourChecks) {
    if (!mirroredTargets.has(check.path)) {
      throw new Error(`${check.path} has flavour checks but is not a mirrored target`);
    }
  }

  return manifest;
}

export function checkSync({ repoRoot = defaultRepoRoot, sourceRepoDir, targetRef } = {}) {
  const manifest = loadSyncManifest({ repoRoot });
  const source = requireSourceRepo(sourceRepoDir);
  const baseCommit = resolveCommit(source, manifest.upstream.lastSyncedCommit);
  const targetCommit = resolveCommit(source, targetRef ?? manifest.upstream.branch);
  ensureDescendant(source, baseCommit, targetCommit);
  const mirrored = manifest.mirrors
    .map((entry) => ({
      ...entry,
      status: changedStatus(source, baseCommit, targetCommit, entry.source),
    }))
    .filter((entry) => entry.status !== "unchanged");
  const watchOnly = manifest.watchOnly
    .map((sourcePath) => ({
      path: sourcePath,
      status: changedStatus(source, baseCommit, targetCommit, sourcePath),
    }))
    .filter((entry) => entry.status !== "unchanged");

  return {
    baseCommit,
    hasChanges: mirrored.length > 0 || watchOnly.length > 0,
    mirrored,
    targetCommit,
    watchOnly,
  };
}

export function updateSync({ repoRoot = defaultRepoRoot, sourceRepoDir, targetRef } = {}) {
  if (fs.existsSync(path.join(repoRoot, pendingRel))) {
    throw new Error(
      `A pending sync report already exists at ${pendingRel}; resolve and finalize it before updating again`,
    );
  }
  const source = requireSourceRepo(sourceRepoDir);
  const manifest = loadSyncManifest({ repoRoot });
  const changes = checkSync({ repoRoot, sourceRepoDir: source, targetRef });
  const mirrored = [];
  const conflicts = [];

  fs.rmSync(path.join(repoRoot, reportRootRel), { recursive: true, force: true });

  for (const entry of manifest.mirrors) {
    const upstreamStatus = changedStatus(
      source,
      changes.baseCommit,
      changes.targetCommit,
      entry.source,
    );
    if (upstreamStatus === "unchanged") {
      mirrored.push({ ...entry, status: "unchanged" });
      continue;
    }

    const targetFile = path.join(repoRoot, entry.target);
    const current = fs.readFileSync(targetFile, "utf8");
    if (upstreamStatus !== "modified") {
      conflicts.push(entry.target);
      mirrored.push({ ...entry, status: "conflict" });
      writeConflictArtifact(
        repoRoot,
        entry.target,
        [
          `${entry.source} was ${upstreamStatus} upstream between:`,
          `base: ${changes.baseCommit}`,
          `target: ${changes.targetCommit}`,
          "",
          "The ClawHub target was left unchanged for maintainer review.",
          "",
        ].join("\n"),
      );
      continue;
    }
    const base = readAt(source, changes.baseCommit, entry.source);
    const upstream = readAt(source, changes.targetCommit, entry.source);
    const merge = mergeText({ base, current, upstream });

    if (merge.status === "conflict") {
      conflicts.push(entry.target);
      mirrored.push({ ...entry, status: "conflict" });
      writeConflictArtifact(repoRoot, entry.target, merge.output);
      continue;
    }

    if (merge.output === current) {
      mirrored.push({ ...entry, status: "already-current" });
      continue;
    }

    fs.writeFileSync(targetFile, merge.output, "utf8");
    mirrored.push({ ...entry, status: "merged" });
  }

  const result = {
    baseCommit: changes.baseCommit,
    conflicts,
    mirrored,
    reviewReasons:
      changes.watchOnly.length > 0 ? ["Watch-only upstream changes require maintainer review"] : [],
    targetCommit: changes.targetCommit,
    watchOnly: changes.watchOnly,
  };

  if (conflicts.length > 0) {
    writePendingReport(repoRoot, result);
    return result;
  }

  try {
    verifyClawHubFlavour({ manifest, repoRoot });
  } catch (error) {
    result.validationErrors = [error instanceof Error ? error.message : String(error)];
    writePendingReport(repoRoot, result);
    return result;
  }
  if (result.reviewReasons.length > 0) {
    writePendingReport(repoRoot, result);
    return result;
  }
  writeManifestPin(repoRoot, changes.targetCommit);
  return result;
}

export function finalizeSync({ repoRoot = defaultRepoRoot, sourceRepoDir } = {}) {
  const source = requireSourceRepo(sourceRepoDir);
  const manifest = loadSyncManifest({ repoRoot });
  const pendingFile = path.join(repoRoot, pendingRel);
  if (!fs.existsSync(pendingFile)) {
    throw new Error(`No pending sync report at ${pendingRel}`);
  }

  const pending = JSON.parse(fs.readFileSync(pendingFile, "utf8"));
  const baseCommit = resolveCommit(source, pending.baseCommit);
  const targetCommit = resolveCommit(source, pending.targetCommit);
  if (manifest.upstream.lastSyncedCommit !== baseCommit) {
    throw new Error(
      `Pending sync base ${baseCommit} does not match manifest pin ${manifest.upstream.lastSyncedCommit}`,
    );
  }

  for (const entry of pending.conflicts) {
    const current = fs.readFileSync(path.join(repoRoot, entry.target));
    const contents = current.toString("utf8");
    if (sha256(current) === entry.currentSha256) {
      throw new Error(`${entry.target} has not been edited since the conflict was reported`);
    }
    if (hasConflictMarkers(contents)) {
      throw new Error(`${entry.target} still contains merge conflict markers`);
    }
  }

  verifyClawHubFlavour({ manifest, repoRoot });
  writeManifestPin(repoRoot, targetCommit);
  fs.rmSync(path.join(repoRoot, reportRootRel), { recursive: true, force: true });
  return { baseCommit, targetCommit };
}

export function verifySync({ repoRoot = defaultRepoRoot } = {}) {
  const manifest = loadSyncManifest({ repoRoot });
  if (fs.existsSync(path.join(repoRoot, pendingRel))) {
    throw new Error(`Pending OpenClaw docs conflicts remain in ${pendingRel}`);
  }
  for (const entry of manifest.mirrors) {
    const file = path.join(repoRoot, entry.target);
    if (!fs.existsSync(file)) throw new Error(`Missing mirrored document ${entry.target}`);
    if (hasConflictMarkers(fs.readFileSync(file, "utf8"))) {
      throw new Error(`${entry.target} contains merge conflict markers`);
    }
  }
  verifyClawHubFlavour({ manifest, repoRoot });
  return {
    mirroredCount: manifest.mirrors.length,
    pinnedCommit: manifest.upstream.lastSyncedCommit,
    watchOnlyCount: manifest.watchOnly.length,
  };
}

export function mergeText({ base, current, upstream }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawhub-docs-merge-"));
  const currentFile = path.join(tempDir, "current.md");
  const baseFile = path.join(tempDir, "base.md");
  const upstreamFile = path.join(tempDir, "upstream.md");
  fs.writeFileSync(currentFile, current, "utf8");
  fs.writeFileSync(baseFile, base, "utf8");
  fs.writeFileSync(upstreamFile, upstream, "utf8");

  const result = spawnSync(
    "git",
    [
      "merge-file",
      "-p",
      "--diff3",
      "-L",
      "ClawHub",
      "-L",
      "OpenClaw sync base",
      "-L",
      "OpenClaw target",
      currentFile,
      baseFile,
      upstreamFile,
    ],
    { encoding: "utf8" },
  );
  fs.rmSync(tempDir, { recursive: true, force: true });

  if (result.status === 0) return { output: result.stdout, status: "clean" };
  if ((result.status ?? -1) > 0) return { output: result.stdout, status: "conflict" };
  throw new Error(`git merge-file failed: ${result.stderr || result.error?.message || "unknown"}`);
}

function verifyClawHubFlavour({ manifest, repoRoot }) {
  for (const check of manifest.flavourChecks) {
    const contents = fs.readFileSync(path.join(repoRoot, check.path), "utf8");
    for (const expected of check.includes) {
      if (!contents.includes(expected)) {
        throw new Error(`${check.path} is missing required text: ${expected}`);
      }
    }
    for (const forbidden of check.excludes ?? []) {
      if (contents.includes(forbidden)) {
        throw new Error(`${check.path} contains forbidden text: ${forbidden}`);
      }
    }
  }

  if (manifest.linkPolicy?.rejectRootRelative) {
    for (const entry of manifest.mirrors) {
      const contents = fs.readFileSync(path.join(repoRoot, entry.target), "utf8");
      if (hasRootRelativeLink(contents)) {
        throw new Error(
          `${entry.target} contains an OpenClaw-style root-relative link; use a ClawHub-local relative link or an absolute docs.openclaw.ai URL`,
        );
      }
    }
  }
}

function normalizeMirrors(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${manifestRel} must declare at least one mirrored document`);
  }
  const sources = new Set();
  const targets = new Set();
  return value.map((entry) => {
    const source = normalizePath(entry?.source, "mirrors.source");
    const target = normalizePath(entry?.target, "mirrors.target");
    if (sources.has(source)) throw new Error(`Duplicate mirrored source ${source}`);
    if (targets.has(target)) throw new Error(`Duplicate mirrored target ${target}`);
    sources.add(source);
    targets.add(target);
    return { source, target };
  });
}

function normalizePaths(value, field) {
  if (!value) return [];
  if (!Array.isArray(value)) throw new Error(`${manifestRel} ${field} must be an array`);
  const paths = value.map((entry) => normalizePath(entry, field));
  if (new Set(paths).size !== paths.length)
    throw new Error(`${manifestRel} ${field} has duplicates`);
  return paths;
}

function normalizeFlavourChecks(value) {
  if (!value) return [];
  if (!Array.isArray(value)) throw new Error(`${manifestRel} flavourChecks must be an array`);
  return value.map((entry) => {
    const check = {
      path: normalizePath(entry?.path, "flavourChecks.path"),
      includes: normalizeStrings(entry?.includes, "flavourChecks.includes"),
    };
    const excludes = normalizeStrings(entry?.excludes, "flavourChecks.excludes");
    if (excludes.length > 0) check.excludes = excludes;
    return check;
  });
}

function normalizeStrings(value, field) {
  if (!value) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry)) {
    throw new Error(`${manifestRel} ${field} must be an array of non-empty strings`);
  }
  return value;
}

function normalizePath(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${manifestRel} ${field} must be a non-empty path`);
  }
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`${manifestRel} ${field} must stay inside the repository: ${value}`);
  }
  return normalized;
}

function changedStatus(sourceRepoDir, baseCommit, targetCommit, sourcePath) {
  const output = git(sourceRepoDir, [
    "diff",
    "--name-status",
    baseCommit,
    targetCommit,
    "--",
    sourcePath,
  ]);
  if (!output) return "unchanged";
  const code = output.split(/\s+/u, 1)[0][0];
  return (
    {
      A: "added",
      D: "deleted",
      M: "modified",
      R: "renamed",
      T: "type-changed",
    }[code] ?? "modified"
  );
}

function resolveCommit(sourceRepoDir, ref) {
  return git(sourceRepoDir, ["rev-parse", `${ref}^{commit}`]);
}

function readAt(sourceRepoDir, ref, sourcePath) {
  const result = spawnSync("git", ["show", `${ref}:${sourcePath}`], {
    cwd: sourceRepoDir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Cannot read ${sourcePath} at ${ref}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function requireSourceRepo(sourceRepoDir) {
  if (!sourceRepoDir) {
    throw new Error("sourceRepoDir is required; the CLI resolves or fetches the OpenClaw source");
  }
  const resolved = path.resolve(sourceRepoDir);
  git(resolved, ["rev-parse", "--git-dir"]);
  return resolved;
}

function writePendingReport(repoRoot, result) {
  const conflicts = result.mirrored
    .filter((entry) => entry.status === "conflict")
    .map(({ source, target }) => ({
      currentSha256: sha256(fs.readFileSync(path.join(repoRoot, target))),
      source,
      target,
    }));
  const report = {
    baseCommit: result.baseCommit,
    conflicts,
    mirrored: result.mirrored,
    reviewReasons: result.reviewReasons ?? [],
    schemaVersion: 1,
    targetCommit: result.targetCommit,
    validationErrors: result.validationErrors ?? [],
    watchOnly: result.watchOnly,
  };
  writeJson(path.join(repoRoot, pendingRel), report);
}

function writeConflictArtifact(repoRoot, target, contents) {
  const filename = `${target.replaceAll("/", "__")}.diff3`;
  const file = path.join(repoRoot, reportRootRel, "conflicts", filename);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, "utf8");
}

function writeManifestPin(repoRoot, commit) {
  const file = path.join(repoRoot, manifestRel);
  const contents = fs.readFileSync(file, "utf8");
  const pattern = /("lastSyncedCommit"\s*:\s*")[^"]+(")/u;
  const matches = contents.match(new RegExp(pattern.source, "gu"));
  if (matches?.length !== 1) {
    throw new Error(`${manifestRel} must contain exactly one lastSyncedCommit field`);
  }
  fs.writeFileSync(file, contents.replace(pattern, `$1${commit}$2`), "utf8");
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hasConflictMarkers(contents) {
  return /^(?:<<<<<<< .+|=======|>>>>>>> .+|\|\|\|\|\|\|\| .+)$/mu.test(contents);
}

function hasRootRelativeLink(contents) {
  return [
    /\]\(\s*<?\/(?!\/)/u,
    /\bhref\s*=\s*["']\/(?!\/)/iu,
    /^\s{0,3}\[[^\]\n]+\]:[ \t]*(?:\n[ \t]*)?<?\/(?!\/)/mu,
  ].some((pattern) => pattern.test(contents));
}

function ensureDescendant(sourceRepoDir, baseCommit, targetCommit) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", baseCommit, targetCommit], {
    cwd: sourceRepoDir,
    encoding: "utf8",
  });
  if (result.status === 0) return;
  if (result.status === 1) {
    throw new Error(
      `OpenClaw target ${targetCommit} is not a descendant of sync base ${baseCommit}`,
    );
  }
  throw new Error(`git merge-base --is-ancestor failed: ${result.stderr.trim()}`);
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function resolveSourceForCli({ manifest, repoRoot, sourceRepoDir, targetRef }) {
  if (sourceRepoDir) {
    const source = requireSourceRepo(sourceRepoDir);
    if (targetRef) return { sourceRepoDir: source, targetRef };
    const syncRef = `refs/remotes/openclaw-doc-sync/${manifest.upstream.branch}`;
    git(source, [
      "fetch",
      "--no-tags",
      manifest.upstream.repository,
      `+${manifest.upstream.branch}:${syncRef}`,
    ]);
    return { sourceRepoDir: source, targetRef: syncRef };
  }

  const cacheParent = path.join(repoRoot, ".cache", "openclaw-docs-sync");
  const source = path.join(cacheParent, "openclaw");
  if (!fs.existsSync(path.join(source, ".git"))) {
    fs.mkdirSync(cacheParent, { recursive: true });
    git(cacheParent, [
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      manifest.upstream.repository,
      source,
    ]);
  }
  git(source, [
    "fetch",
    "--no-tags",
    "origin",
    `+${manifest.upstream.branch}:refs/remotes/origin/${manifest.upstream.branch}`,
  ]);
  return {
    sourceRepoDir: source,
    targetRef: targetRef ?? `origin/${manifest.upstream.branch}`,
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!["check", "update", "finalize", "verify"].includes(command)) {
    throw new Error(
      "Usage: node scripts/docs-sync/openclaw-plugin-docs.mjs <check|update|finalize|verify> [--source <path>] [--to <ref>] [--json]",
    );
  }
  const options = { command, json: false, repoRoot: defaultRepoRoot };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--source") options.sourceRepoDir = rest[++index];
    else if (value === "--to") options.targetRef = rest[++index];
    else if (value === "--repo-root") options.repoRoot = path.resolve(rest[++index]);
    else if (value === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let result;
  if (options.command === "verify") {
    result = verifySync({ repoRoot: options.repoRoot });
  } else {
    const manifest = loadSyncManifest({ repoRoot: options.repoRoot });
    const source = resolveSourceForCli({ manifest, ...options });
    const syncOptions = { repoRoot: options.repoRoot, ...source };
    if (options.command === "check") result = checkSync(syncOptions);
    else if (options.command === "update") result = updateSync(syncOptions);
    else result = finalizeSync(syncOptions);
  }

  if (options.json) console.log(JSON.stringify(result, null, 2));
  else printSummary(options.command, result);
  if (result.conflicts?.length || result.validationErrors?.length || result.reviewReasons?.length) {
    process.exitCode = 2;
  }
  return result;
}

function printSummary(command, result) {
  console.log(`OpenClaw docs sync ${command} complete.`);
  if (result.baseCommit) console.log(`Base: ${result.baseCommit}`);
  if (result.targetCommit) console.log(`Target: ${result.targetCommit}`);
  if (result.mirrored) {
    const changed = result.mirrored.filter((entry) => entry.status !== "unchanged");
    console.log(`Mirrored changes: ${changed.length}`);
  }
  if (result.watchOnly) console.log(`Watch-only changes: ${result.watchOnly.length}`);
  if (result.conflicts?.length) console.log(`Conflicts: ${result.conflicts.join(", ")}`);
  if (result.validationErrors?.length) {
    console.log(`Validation errors: ${result.validationErrors.join(", ")}`);
  }
  if (result.reviewReasons?.length) {
    console.log(`Review required: ${result.reviewReasons.join(", ")}`);
  }
}

const isCli = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isCli) main();
