/* @vitest-environment node */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("clawhub CLI npm publish", () => {
  it("rejects extra arguments before invoking npm", () => {
    const root = mkdtempSync(join(tmpdir(), "clawhub-cli-npm-publish-"));

    try {
      const fakeBin = join(root, "bin");
      const publishMarker = join(root, "published");
      mkdirSync(fakeBin);
      writeFileSync(
        join(fakeBin, "npm"),
        `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > "${publishMarker}"\n`,
      );
      chmodSync(join(fakeBin, "npm"), 0o755);

      const result = spawnSync(
        "bash",
        ["scripts/clawhub-cli-npm-publish.sh", "--publish", "package.tgz", "--tag", "next"],
        {
          cwd: resolve("."),
          encoding: "utf8",
          env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
        },
      );

      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        "usage: bash scripts/clawhub-cli-npm-publish.sh --publish [package.tgz]",
      );
      expect(() => readFileSync(publishMarker)).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects a tarball whose package version does not match the source package", () => {
    const root = mkdtempSync(join(tmpdir(), "clawhub-cli-npm-publish-"));

    try {
      const packageVersion = JSON.parse(
        readFileSync(resolve("packages/clawhub/package.json"), "utf8"),
      ).version;
      const fixtureRoot = join(root, "fixture");
      const fakeBin = join(root, "bin");
      const publishMarker = join(root, "published");
      mkdirSync(join(fixtureRoot, "package"), { recursive: true });
      mkdirSync(fakeBin);
      writeFileSync(
        join(fixtureRoot, "package", "package.json"),
        JSON.stringify({
          name: "clawhub",
          version: packageVersion === "0.0.0" ? "0.0.1" : "0.0.0",
        }),
      );
      writeFileSync(
        join(fakeBin, "npm"),
        `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > "${publishMarker}"\n`,
      );
      chmodSync(join(fakeBin, "npm"), 0o755);

      const tarball = join(root, "clawhub.tgz");
      const archive = spawnSync(
        "tar",
        ["-czf", tarball, "-C", fixtureRoot, "package/package.json"],
        { encoding: "utf8" },
      );
      expect(archive.status).toBe(0);

      const result = spawnSync(
        "bash",
        ["scripts/clawhub-cli-npm-publish.sh", "--publish", tarball],
        {
          cwd: resolve("."),
          encoding: "utf8",
          env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
        },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("does not match packages/clawhub/package.json version");
      expect(() => readFileSync(publishMarker)).toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
