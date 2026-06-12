import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEPENDENCY_NAME = "@openclaw/plugin-inspector";
const PACKAGE_MANIFEST_FILES = ["package.json", "packages/clawhub/package.json"];
const PACKAGE_MANAGER_FILES = new Set([...PACKAGE_MANIFEST_FILES, "bun.lock"]);

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
  basePackageJsonByPath,
  headPackageJsonByPath,
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

  const baseManifests = normalizeManifestInputs(basePackageJsonByPath, basePackageJson);
  const headManifests = normalizeManifestInputs(headPackageJsonByPath, headPackageJson);
  const versions = PACKAGE_MANIFEST_FILES.map((file) => ({
    file,
    oldVersion: readPinnedPluginInspectorVersion(baseManifests[file] ?? "{}"),
    newVersion: readPinnedPluginInspectorVersion(headManifests[file] ?? "{}"),
  }));

  const changedPin = versions.find(
    (entry) => entry.oldVersion && entry.newVersion && entry.oldVersion !== entry.newVersion,
  );
  if (changedPin) {
    return {
      changed: true,
      oldVersion: changedPin.oldVersion,
      newVersion: changedPin.newVersion,
      reason: `pinned ${DEPENDENCY_NAME} changed in ${changedPin.file} from ${changedPin.oldVersion} to ${changedPin.newVersion}`,
    };
  }

  const comparablePin = versions.find((entry) => entry.oldVersion && entry.newVersion);
  if (!comparablePin) {
    return {
      changed: false,
      oldVersion: undefined,
      newVersion: undefined,
      reason: `pinned ${DEPENDENCY_NAME} is missing from package.json`,
    };
  }

  return {
    changed: false,
    oldVersion: comparablePin.oldVersion,
    newVersion: comparablePin.newVersion,
    reason: `pinned ${DEPENDENCY_NAME} did not change`,
  };
}

function normalizeManifestInputs(manifestsByPath, fallbackPackageJson) {
  if (manifestsByPath && typeof manifestsByPath === "object") {
    return manifestsByPath;
  }
  return fallbackPackageJson ? { "package.json": fallbackPackageJson } : {};
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

function readPackageJsonsAt(ref) {
  return Object.fromEntries(
    PACKAGE_MANIFEST_FILES.map((file) => [file, git(["show", `${ref}:${file}`])]),
  );
}

function changedFilesBetween(base, head) {
  const output = git(["diff", "--name-only", base, head, "--", ...PACKAGE_MANAGER_FILES]);
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
    basePackageJsonByPath: readPackageJsonsAt(base),
    headPackageJsonByPath: readPackageJsonsAt(head),
  });
  writeOutput(result);
  return result;
}

const isCli = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (isCli) main();
