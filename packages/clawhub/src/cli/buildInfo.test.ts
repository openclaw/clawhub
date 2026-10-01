/* @vitest-environment node */

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getCliBuildLabel } from "./buildInfo.js";

const tempDirs: string[] = [];

async function makeTmpDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("getCliBuildLabel", () => {
  it("includes the current commit when running inside a linked worktree", async () => {
    const root = await makeTmpDir("clawhub-build-info-");
    const repo = join(root, "repo");
    const worktree = join(root, "linked");
    await mkdir(repo, { recursive: true });
    git(repo, ["init"]);
    git(repo, ["config", "user.name", "Test"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    await writeFile(join(repo, "README.md"), "test\n", "utf8");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-m", "init"]);
    git(repo, ["worktree", "add", "-b", "linked", worktree]);

    const expected = git(worktree, ["rev-parse", "HEAD"]).slice(0, 8);
    const previousCwd = process.cwd();
    const previousEnv = {
      CLAWHUB_COMMIT: process.env.CLAWHUB_COMMIT,
      CLAWDHUB_COMMIT: process.env.CLAWDHUB_COMMIT,
      VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
      GITHUB_SHA: process.env.GITHUB_SHA,
      COMMIT_SHA: process.env.COMMIT_SHA,
    };
    try {
      for (const key of Object.keys(previousEnv)) {
        delete process.env[key as keyof typeof previousEnv];
      }
      process.chdir(worktree);

      expect(getCliBuildLabel()).toContain(`(${expected})`);
    } finally {
      process.chdir(previousCwd);
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key as keyof typeof previousEnv];
        } else {
          process.env[key as keyof typeof previousEnv] = value;
        }
      }
    }
  });
});
