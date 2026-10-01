#!/usr/bin/env node

import { readFileSync } from "node:fs";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if ((arg === "--version" || arg === "-v") && next) {
      options.version = next;
      index += 1;
      continue;
    }
    if ((arg === "--tag" || arg === "--release-tag") && next) {
      options.tag = next;
      index += 1;
      continue;
    }
    if (arg === "--changelog" && next) {
      options.changelog = next;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }
  return options;
}

function usage() {
  return `Usage: node scripts/extract-changelog-release.mjs --version X.Y.Z
       node scripts/extract-changelog-release.mjs --tag vX.Y.Z

Options:
  --version, -v      Stable release version to extract.
  --tag              Stable release tag to extract.
  --changelog        Changelog path. Defaults to CHANGELOG.md.
`;
}

function versionFromOptions(options) {
  const raw = options.version ?? options.tag?.replace(/^v/, "") ?? "";
  const version = raw.trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Release version must match X.Y.Z; found "${raw || "<missing>"}".`);
  }
  return version;
}

function extractReleaseSection(changelog, version) {
  const lines = changelog.replace(/\r\n/g, "\n").split("\n");
  const heading = new RegExp(`^##\\s+${version.replaceAll(".", "\\.")}(?:\\s+-\\s+.*)?\\s*$`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) {
    throw new Error(`CHANGELOG.md does not contain a section for ${version}.`);
  }

  const end = lines.findIndex((line, index) => index > start && /^##\s+\S/.test(line));
  const section = lines
    .slice(start, end === -1 ? lines.length : end)
    .join("\n")
    .trim();
  const content = lines
    .slice(start + 1, end === -1 ? lines.length : end)
    .join("\n")
    .trim();
  if (!content) {
    throw new Error(`CHANGELOG.md section for ${version} is empty.`);
  }
  return `${section}\n`;
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  console.log(usage());
  process.exit(0);
}

try {
  const version = versionFromOptions(options);
  const changelogPath = options.changelog ?? "CHANGELOG.md";
  const changelog = readFileSync(changelogPath, "utf8");
  process.stdout.write(extractReleaseSection(changelog, version));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
