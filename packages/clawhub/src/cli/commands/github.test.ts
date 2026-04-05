/* @vitest-environment node */

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGitHubSource, resolveLocalGitInfo, resolveSourceInput } from "./github";

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
  vi.restoreAllMocks();
});

function mockGitHubCommitLookup(validRefs: string[]) {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    const match = url.match(/\/repos\/owner\/repo\/commits\/(.+)$/);
    if (!match) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    const ref = decodeURIComponent(match[1] ?? "");
    if (!validRefs.includes(ref)) {
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify({ sha: "0123456789abcdef0123456789abcdef01234567" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  Object.defineProperty(globalThis, "fetch", {
    value: fetchMock,
    configurable: true,
    writable: true,
  });
  return () => {
    Object.defineProperty(globalThis, "fetch", {
      value: originalFetch,
      configurable: true,
      writable: true,
    });
  };
}

describe("github publish source helpers", () => {
  it.each([
    [
      "owner/repo",
      {
        kind: "github",
        owner: "owner",
        repo: "repo",
        path: ".",
        url: "https://github.com/owner/repo",
      },
    ],
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
    const restoreFetch =
      input.includes("/tree/") || input.includes("/blob/")
        ? mockGitHubCommitLookup([String((expected as { ref?: string }).ref ?? "")])
        : null;
    try {
      await expect(resolveSourceInput(input, { workdir })).resolves.toEqual(expected);
    } finally {
      restoreFetch?.();
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("parses tree URLs whose refs contain slashes", async () => {
    const workdir = await makeTmpDir();
    const restoreFetch = mockGitHubCommitLookup(["feature/new-ui"]);
    try {
      await expect(
        resolveSourceInput("https://github.com/owner/repo/tree/feature/new-ui/plugins/demo", {
          workdir,
        }),
      ).resolves.toEqual({
        kind: "github",
        owner: "owner",
        repo: "repo",
        ref: "feature/new-ui",
        path: "plugins/demo",
        url: "https://github.com/owner/repo",
      });
    } finally {
      restoreFetch();
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it.each([
    "./local-folder",
    "/absolute/path",
    "~/path",
    ".",
    "@scope/package",
    "owner/repo/extra",
  ])("treats %s as a local path", async (input) => {
    const workdir = await makeTmpDir();
    try {
      const resolved = await resolveSourceInput(input, { workdir });
      expect(resolved.kind).toBe("local");
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

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
      runGit(root, [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "init",
      ]);
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

  it("extracts GitHub archives that contain explicit directory entries", async () => {
    const archiveBytes = zipSync({
      "repo-root/.agents/": new Uint8Array(),
      "repo-root/.agents/config.json": new TextEncoder().encode('{"ok":true}\n'),
      "repo-root/package.json": new TextEncoder().encode('{"name":"demo","version":"1.0.0"}\n'),
      "repo-root/openclaw.plugin.json": new TextEncoder().encode(
        '{"id":"demo","configSchema":{"type":"object"}}\n',
      ),
    });
    const archiveBody = archiveBytes.buffer.slice(
      archiveBytes.byteOffset,
      archiveBytes.byteOffset + archiveBytes.byteLength,
    ) as ArrayBuffer;

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ default_branch: "main" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sha: "0123456789abcdef0123456789abcdef01234567" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(archiveBody, {
          status: 200,
          headers: { "content-type": "application/zip" },
        }),
      );
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
      value: fetchMock,
      configurable: true,
      writable: true,
    });

    const fetched = await fetchGitHubSource({
      kind: "github",
      owner: "owner",
      repo: "repo",
      path: ".",
      url: "https://github.com/owner/repo",
    });

    try {
      expect(await readFile(join(fetched.dir, ".agents", "config.json"), "utf8")).toContain(
        '"ok":true',
      );
      expect(await readFile(join(fetched.dir, "package.json"), "utf8")).toContain('"name":"demo"');
    } finally {
      await fetched.cleanup();
      Object.defineProperty(globalThis, "fetch", {
        value: originalFetch,
        configurable: true,
        writable: true,
      });
    }
  });

  it("rejects GitHub archives with unsafe paths", async () => {
    const archiveBytes = zipSync({
      "repo-root/../../escape.txt": new TextEncoder().encode("bad\n"),
      "repo-root/package.json": new TextEncoder().encode('{"name":"demo","version":"1.0.0"}\n'),
      "repo-root/openclaw.plugin.json": new TextEncoder().encode(
        '{"id":"demo","configSchema":{"type":"object"}}\n',
      ),
    });
    const archiveBody = archiveBytes.buffer.slice(
      archiveBytes.byteOffset,
      archiveBytes.byteOffset + archiveBytes.byteLength,
    ) as ArrayBuffer;

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ default_branch: "main" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sha: "0123456789abcdef0123456789abcdef01234567" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(archiveBody, {
          status: 200,
          headers: { "content-type": "application/zip" },
        }),
      );
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, "fetch", {
      value: fetchMock,
      configurable: true,
      writable: true,
    });

    try {
      await expect(
        fetchGitHubSource({
          kind: "github",
          owner: "owner",
          repo: "repo",
          path: ".",
          url: "https://github.com/owner/repo",
        }),
      ).rejects.toThrow(/Unsafe path in archive/i);
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        value: originalFetch,
        configurable: true,
        writable: true,
      });
    }
  });
});
