/* @vitest-environment node */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLocalGitInfo, resolveSourceInput } from "./github";

async function makeTmpDir() {
  return await mkdtemp(join(tmpdir(), "clawhub-github-test-"));
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

afterEach(() => {
  // no-op hook keeps the file shape consistent with the command test suite
});

describe("github publish source helpers", () => {
  it.each([
    ["owner/repo", { kind: "github", owner: "owner", repo: "repo", path: ".", url: "https://github.com/owner/repo" }],
    [
      "owner/repo@v1.0.0",
      {
        kind: "github",
        owner: "owner",
        repo: "repo",
        ref: "v1.0.0",
        path: ".",
        url: "https://github.com/owner/repo",
      },
    ],
    [
      "owner/repo@main",
      {
        kind: "github",
        owner: "owner",
        repo: "repo",
        ref: "main",
        path: ".",
        url: "https://github.com/owner/repo",
      },
    ],
    [
      "https://github.com/owner/repo",
      {
        kind: "github",
        owner: "owner",
        repo: "repo",
        path: ".",
        url: "https://github.com/owner/repo",
      },
    ],
    [
      "https://github.com/owner/repo/tree/main",
      {
        kind: "github",
        owner: "owner",
        repo: "repo",
        ref: "main",
        path: ".",
        url: "https://github.com/owner/repo",
      },
    ],
    [
      "https://github.com/owner/repo/tree/main/plugins/demo",
      {
        kind: "github",
        owner: "owner",
        repo: "repo",
        ref: "main",
        path: "plugins/demo",
        url: "https://github.com/owner/repo",
      },
    ],
    [
      "https://github.com/owner/repo/blob/main/plugins/demo/index.ts",
      {
        kind: "github",
        owner: "owner",
        repo: "repo",
        ref: "main",
        path: "plugins/demo",
        url: "https://github.com/owner/repo",
      },
    ],
    [
      "https://github.com/owner/repo.git",
      {
        kind: "github",
        owner: "owner",
        repo: "repo",
        path: ".",
        url: "https://github.com/owner/repo",
      },
    ],
  ])("parses %s as a GitHub source", async (input, expected) => {
    const workdir = await makeTmpDir();
    try {
      await expect(resolveSourceInput(input, { workdir })).resolves.toEqual(expected);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it.each(["./local-folder", "/absolute/path", "~/path", ".", "@scope/package", "owner/repo/extra"])(
    "treats %s as a local path",
    async (input) => {
      const workdir = await makeTmpDir();
      try {
        const resolved = await resolveSourceInput(input, { workdir });
        expect(resolved.kind).toBe("local");
      } finally {
        await rm(workdir, { recursive: true, force: true });
      }
    },
  );

  it("prefers an existing local directory over GitHub shorthand", async () => {
    const workdir = await makeTmpDir();
    try {
      const localDir = join(workdir, "owner", "repo");
      await mkdir(localDir, { recursive: true });

      await expect(resolveSourceInput("owner/repo", { workdir })).resolves.toEqual({
        kind: "local",
        path: localDir,
      });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("resolves git metadata for a nested folder in a real git repo", async () => {
    const root = await makeTmpDir();
    try {
      const nested = join(root, "plugins", "demo");
      await mkdir(nested, { recursive: true });
      await writeFile(join(nested, "package.json"), '{"name":"demo"}\n', "utf8");

      runGit(root, ["init", "-b", "main"]);
      runGit(root, ["remote", "add", "origin", "git@github.com:openclaw/demo-repo.git"]);
      runGit(root, ["add", "."]);
      runGit(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"]);
      const commit = runGit(root, ["rev-parse", "HEAD"]);
      const gitRoot = runGit(root, ["rev-parse", "--show-toplevel"]);
      runGit(root, ["-c", "tag.gpgSign=false", "tag", "v1.0.0"]);

      expect(resolveLocalGitInfo(nested)).toEqual({
        root: gitRoot,
        path: "plugins/demo",
        repo: "openclaw/demo-repo",
        commit,
        ref: "v1.0.0",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns null for a non-git folder", async () => {
    const workdir = await makeTmpDir();
    try {
      const folder = join(workdir, "not-a-repo");
      await mkdir(folder, { recursive: true });
      expect(resolveLocalGitInfo(folder)).toBeNull();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });
});
