/* @vitest-environment node */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const lockfile = readFileSync(join(repoRoot, "bun.lock"), "utf8");

describe("package configuration", () => {
  it("pins the preinstall package-manager guard to its declared version", () => {
    const preinstall = packageJson.scripts?.preinstall ?? "";
    const match = preinstall.match(/^bunx --bun only-allow@(\d+\.\d+\.\d+) bun$/);

    const version = packageJson.devDependencies?.["only-allow"];

    expect(match?.[1]).toBe(version);
    expect(lockfile).toContain(`"only-allow": ["only-allow@${version}"`);
  });
});
