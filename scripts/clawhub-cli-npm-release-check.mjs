#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const EXPECTED_REPOSITORY_URL = "https://github.com/openclaw/clawhub";
const EXPECTED_REPOSITORY_DIRECTORY = "packages/clawhub";
const EXPECTED_HOMEPAGE_URL = "https://clawhub.ai";
const EXPECTED_BUGS_URL = "https://github.com/openclaw/clawhub/issues";
const EXPECTED_BIN_PATH = "bin/clawdhub.js";

function parseArgs(argv) {
  const resolved = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if ((arg === "--tag" || arg === "--release-tag") && next) {
      resolved.tag = next;
      index += 1;
      continue;
    }
    if (arg === "--release-sha" && next) {
      resolved.releaseSha = next;
      index += 1;
      continue;
    }
    if (arg === "--release-main-ref" && next) {
      resolved.releaseMainRef = next;
      index += 1;
    }
  }
  return resolved;
}

function normalizeUrl(value) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/^git\+/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
}

function readPackageJson() {
  return JSON.parse(
    readFileSync(new URL("../packages/clawhub/package.json", import.meta.url), "utf8"),
  );
}

function isStableSemverVersion(value) {
  return /^\d+\.\d+\.\d+$/.test(value.trim());
}

function collectPackageMetadataErrors(pkg) {
  const errors = [];
  const repoUrl =
    typeof pkg.repository === "string"
      ? normalizeUrl(pkg.repository)
      : normalizeUrl(pkg.repository?.url);
  const repoDirectory =
    pkg.repository && typeof pkg.repository === "object" ? pkg.repository.directory : undefined;
  const bugsUrl =
    pkg.bugs && typeof pkg.bugs === "object" ? normalizeUrl(pkg.bugs.url) : normalizeUrl(pkg.bugs);

  if (pkg.name !== "clawhub") {
    errors.push(`packages/clawhub/package.json name must be "clawhub"; found "${pkg.name ?? ""}".`);
  }
  if (!isStableSemverVersion(String(pkg.version ?? ""))) {
    errors.push(
      `packages/clawhub/package.json version must be stable semver (X.Y.Z); found "${pkg.version ?? ""}".`,
    );
  }
  if (!String(pkg.description ?? "").trim()) {
    errors.push("packages/clawhub/package.json description must be non-empty.");
  }
  if (pkg.license !== "MIT") {
    errors.push(
      `packages/clawhub/package.json license must be "MIT"; found "${pkg.license ?? ""}".`,
    );
  }
  if (normalizeUrl(pkg.homepage) !== EXPECTED_HOMEPAGE_URL) {
    errors.push(
      `packages/clawhub/package.json homepage must resolve to ${EXPECTED_HOMEPAGE_URL}; found "${
        normalizeUrl(pkg.homepage) || "<missing>"
      }".`,
    );
  }
  if (bugsUrl !== EXPECTED_BUGS_URL) {
    errors.push(
      `packages/clawhub/package.json bugs.url must resolve to ${EXPECTED_BUGS_URL}; found "${
        bugsUrl || "<missing>"
      }".`,
    );
  }
  if (repoUrl !== EXPECTED_REPOSITORY_URL) {
    errors.push(
      `packages/clawhub/package.json repository.url must resolve to ${EXPECTED_REPOSITORY_URL}; found "${
        repoUrl || "<missing>"
      }".`,
    );
  }
  if (repoDirectory !== EXPECTED_REPOSITORY_DIRECTORY) {
    errors.push(
      `packages/clawhub/package.json repository.directory must be "${EXPECTED_REPOSITORY_DIRECTORY}"; found "${
        typeof repoDirectory === "string" ? repoDirectory : "<missing>"
      }".`,
    );
  }
  if (pkg.bin?.clawhub !== EXPECTED_BIN_PATH) {
    errors.push(
      `packages/clawhub/package.json bin.clawhub must be "${EXPECTED_BIN_PATH}"; found "${
        pkg.bin?.clawhub ?? ""
      }".`,
    );
  }
  if (pkg.bin?.clawdhub !== EXPECTED_BIN_PATH) {
    errors.push(
      `packages/clawhub/package.json bin.clawdhub must be "${EXPECTED_BIN_PATH}"; found "${
        pkg.bin?.clawdhub ?? ""
      }".`,
    );
  }

  return errors;
}

function collectReleaseTagErrors({ packageVersion, releaseTag, releaseSha, releaseMainRef }) {
  const errors = [];
  const normalizedTag = String(releaseTag ?? "").trim();
  const normalizedVersion = String(packageVersion ?? "").trim();

  if (!normalizedTag) {
    errors.push("Release tag is required.");
    return errors;
  }
  if (!/^v\d+\.\d+\.\d+$/.test(normalizedTag)) {
    errors.push(`Release tag must match vX.Y.Z; found "${normalizedTag}".`);
  }
  if (normalizedTag !== `v${normalizedVersion}`) {
    errors.push(
      `Release tag ${normalizedTag} does not match packages/clawhub/package.json version ${normalizedVersion}; expected v${normalizedVersion}.`,
    );
  }
  if (releaseSha?.trim() && releaseMainRef?.trim()) {
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", releaseSha.trim(), releaseMainRef.trim()],
        { stdio: "ignore" },
      );
    } catch {
      errors.push(
        `Tagged commit ${releaseSha.trim()} is not contained in ${releaseMainRef.trim()}.`,
      );
    }
  }

  return errors;
}

const args = parseArgs(process.argv.slice(2));
const pkg = readPackageJson();
const releaseTag = args.tag ?? process.env.RELEASE_TAG ?? "";
const releaseSha = args.releaseSha ?? process.env.RELEASE_SHA ?? "";
const releaseMainRef = args.releaseMainRef ?? process.env.RELEASE_MAIN_REF ?? "";

const errors = [
  ...collectPackageMetadataErrors(pkg),
  ...collectReleaseTagErrors({
    packageVersion: String(pkg.version ?? ""),
    releaseTag,
    releaseSha,
    releaseMainRef,
  }),
];

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log(`Release metadata OK for clawhub@${pkg.version} (${releaseTag}).`);
