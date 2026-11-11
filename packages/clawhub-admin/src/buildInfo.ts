import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readGitCommitFromFiles, shortCommit } from "../../clawhub/src/cli/buildInfo.js";

type PackageJson = { version?: string };

function readPackageVersion() {
  try {
    const path = findPackageJson(dirname(fileURLToPath(import.meta.url)));
    if (!path) return "0.0.0";
    const raw = readFileSync(path, "utf8");
    const pkg = JSON.parse(raw) as PackageJson;
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function findPackageJson(start: string) {
  let current = resolve(start);
  for (;;) {
    const candidate = join(current, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string };
        if (pkg.name === "@openclaw/clawhub-admin") return candidate;
      } catch {
        // keep walking
      }
    }
    const parent = resolve(current, "..");
    if (parent === current) return null;
    current = parent;
  }
}

function getCliCommit() {
  const candidates = [
    process.env.CLAWHUB_ADMIN_COMMIT,
    process.env.CLAWHUB_COMMIT,
    process.env.CLAWDHUB_COMMIT,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.GITHUB_SHA,
    process.env.COMMIT_SHA,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const short = shortCommit(candidate);
    if (short) return short;
  }
  return readGitCommitFromFiles();
}

export function getAdminCliVersion() {
  return readPackageVersion();
}

export function getAdminCliBuildLabel() {
  const version = getAdminCliVersion();
  const commit = getCliCommit();
  return commit ? `v${version} (${commit})` : `v${version}`;
}
