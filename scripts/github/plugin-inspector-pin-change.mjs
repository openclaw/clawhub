import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEPENDENCY_NAME = "@openclaw/plugin-inspector";
const PACKAGE_MANAGER_FILES = new Set(["package.json", "bun.lock"]);

export function readPinnedPluginInspectorVersion(packageJsonText) {
  const parsed = JSON.parse(packageJsonText);
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const version = parsed?.[field]?.[DEPENDENCY_NAME];
    if (typeof version === "string" && version.trim()) return version.trim();
  }
  return undefined;
}

export function detectPinnedPluginInspectorChange({
  changedFiles,
  basePackageJson,
  headPackageJson,
}) {
  const normalizedChangedFiles = changedFiles.map((file) => file.replace(/^\.\//, ""));
  if (!normalizedChangedFiles.some((file) => PACKAGE_MANAGER_FILES.has(file))) {
    return {
      changed: false,
      oldVersion: undefined,
      newVersion: undefined,
      reason: "no package manager files changed",
    };
  }

  const oldVersion = readPinnedPluginInspectorVersion(basePackageJson);
  const newVersion = readPinnedPluginInspectorVersion(headPackageJson);
  if (!oldVersion || !newVersion) {
    return {
      changed: false,
      oldVersion,
      newVersion,
      reason: `pinned ${DEPENDENCY_NAME} is missing from package.json`,
    };
  }

  if (oldVersion === newVersion) {
    return {
      changed: false,
      oldVersion,
      newVersion,
      reason: `pinned ${DEPENDENCY_NAME} did not change`,
    };
  }

  return {
    changed: true,
    oldVersion,
    newVersion,
    reason: `pinned ${DEPENDENCY_NAME} changed from ${oldVersion} to ${newVersion}`,
  };
}

function parseArgs(argv) {
  const args = { base: undefined, head: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--base") args.base = argv[++index];
    else if (value === "--head") args.head = argv[++index];
  }
  if (!args.base || !args.head) {
    throw new Error(
      "Usage: node scripts/github/plugin-inspector-pin-change.mjs --base <sha> --head <sha>",
    );
  }
  return args;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function readPackageJsonAt(ref) {
  return git(["show", `${ref}:package.json`]);
}

function changedFilesBetween(base, head) {
  const output = git(["diff", "--name-only", base, head, "--", "package.json", "bun.lock"]);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function writeOutput(result) {
  const lines = [
    `changed=${result.changed ? "true" : "false"}`,
    `old_version=${result.oldVersion ?? ""}`,
    `new_version=${result.newVersion ?? ""}`,
    `reason=${result.reason}`,
  ];
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
  console.log(result.changed ? "Dispatch required." : "Dispatch skipped.");
  console.log(result.reason);
}

export function main(argv = process.argv.slice(2)) {
  const { base, head } = parseArgs(argv);
  const result = detectPinnedPluginInspectorChange({
    changedFiles: changedFilesBetween(base, head),
    basePackageJson: readPackageJsonAt(base),
    headPackageJson: readPackageJsonAt(head),
  });
  writeOutput(result);
  return result;
}

const isCli = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (isCli) main();
