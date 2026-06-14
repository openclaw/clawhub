/* @vitest-environment node */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkSync,
  finalizeSync,
  loadSyncManifest,
  updateSync,
  verifySync,
} from "./openclaw-plugin-docs.mjs";

describe("OpenClaw plugin docs sync", () => {
  it("three-way merges upstream changes while preserving ClawHub additions", () => {
    const fixture = createFixture({
      baseRuntime: "# Runtime\n\n## Behavior\n\nRuntime behavior.\n",
      currentRuntime: "# Runtime\n\nPublish with ClawHub.\n\n## Behavior\n\nRuntime behavior.\n",
      upstreamRuntime: "# Runtime\n\n## Behavior\n\nUpdated runtime behavior.\n",
    });
    const manifestBefore = read(fixture.workspace, "scripts/docs-sync/openclaw-plugin-docs.json");

    const result = updateSync(fixture.options);

    expect(result.conflicts).toEqual([]);
    expect(result.mirrored).toContainEqual({
      source: "docs/plugins/runtime.md",
      status: "merged",
      target: "docs/plugins/runtime.md",
    });
    expect(read(fixture.workspace, "docs/plugins/runtime.md")).toBe(
      "# Runtime\n\nPublish with ClawHub.\n\n## Behavior\n\nUpdated runtime behavior.\n",
    );
    expect(readManifest(fixture.workspace).upstream.lastSyncedCommit).toBe(fixture.targetCommit);
    expect(read(fixture.workspace, "scripts/docs-sync/openclaw-plugin-docs.json")).toBe(
      manifestBefore.replace(fixture.baseCommit, fixture.targetCommit),
    );
  });

  it("reports watch-only changes without copying them into ClawHub", () => {
    const fixture = createFixture({
      baseWatch: "# Skills\n\nOld runtime guidance.\n",
      currentWatch: "# ClawHub skills\n\nRegistry guidance.\n",
      upstreamWatch: "# Skills\n\nNew runtime guidance.\n",
    });

    const result = checkSync(fixture.options);

    expect(result.watchOnly).toEqual([
      {
        path: "docs/tools/skills.md",
        status: "modified",
      },
    ]);
    expect(read(fixture.workspace, "docs/creating-skills.md")).toBe(
      "# ClawHub skills\n\nRegistry guidance.\n",
    );
  });

  it("rejects a target commit that would move the OpenClaw pin backward", () => {
    const fixture = createFixture();
    const manifest = readManifest(fixture.workspace);
    manifest.upstream.lastSyncedCommit = fixture.targetCommit;
    writeManifest(fixture.workspace, manifest);

    expect(() =>
      checkSync({
        ...fixture.options,
        targetRef: fixture.baseCommit,
      }),
    ).toThrow(/is not a descendant/);
  });

  it("leaves conflicted targets unchanged and writes a pending resolution report", () => {
    const fixture = createFixture({
      baseRuntime: "# Runtime\n\nMode: base\n",
      currentRuntime: "# Runtime\n\nMode: ClawHub-specific\n",
      upstreamRuntime: "# Runtime\n\nMode: upstream\n",
    });

    const result = updateSync(fixture.options);

    expect(result.conflicts).toEqual(["docs/plugins/runtime.md"]);
    expect(read(fixture.workspace, "docs/plugins/runtime.md")).toBe(
      "# Runtime\n\nMode: ClawHub-specific\n",
    );
    expect(readManifest(fixture.workspace).upstream.lastSyncedCommit).toBe(fixture.baseCommit);
    expect(JSON.parse(read(fixture.workspace, "docs/.openclaw-sync/pending.json"))).toMatchObject({
      baseCommit: fixture.baseCommit,
      targetCommit: fixture.targetCommit,
      conflicts: [
        {
          source: "docs/plugins/runtime.md",
          target: "docs/plugins/runtime.md",
        },
      ],
    });
    expect(
      read(fixture.workspace, "docs/.openclaw-sync/conflicts/docs__plugins__runtime.md.diff3"),
    ).toContain("<<<<<<<");
  });

  it("finalizes a manually resolved conflict only after the target was edited", () => {
    const fixture = createFixture({
      baseRuntime: "# Runtime\n\nMode: base\n",
      currentRuntime: "# Runtime\n\nMode: ClawHub-specific\n",
      upstreamRuntime: "# Runtime\n\nMode: upstream\n",
    });
    updateSync(fixture.options);

    write(
      fixture.workspace,
      "docs/plugins/runtime.md",
      "# Runtime\n\nMode: upstream\n\nPublish with ClawHub.\n",
    );
    const result = finalizeSync(fixture.options);

    expect(result.targetCommit).toBe(fixture.targetCommit);
    expect(readManifest(fixture.workspace).upstream.lastSyncedCommit).toBe(fixture.targetCommit);
    expect(fs.existsSync(path.join(fixture.workspace, "docs/.openclaw-sync"))).toBe(false);
  });

  it("refuses to finalize an untouched conflict", () => {
    const fixture = createFixture({
      baseRuntime: "# Runtime\n\nMode: base\n",
      currentRuntime: "# Runtime\n\nMode: ClawHub-specific\n",
      upstreamRuntime: "# Runtime\n\nMode: upstream\n",
    });
    updateSync(fixture.options);

    expect(() => finalizeSync(fixture.options)).toThrow(/has not been edited/);
    expect(readManifest(fixture.workspace).upstream.lastSyncedCommit).toBe(fixture.baseCommit);
  });

  it("refuses to replace an existing pending conflict report", () => {
    const fixture = createFixture({
      baseRuntime: "# Runtime\n\nMode: base\n",
      currentRuntime: "# Runtime\n\nMode: ClawHub-specific\n",
      upstreamRuntime: "# Runtime\n\nMode: upstream\n",
    });
    updateSync(fixture.options);

    expect(() => updateSync(fixture.options)).toThrow(/pending sync report already exists/);
  });

  it("keeps the old pin when a clean merge removes required ClawHub guidance", () => {
    const fixture = createFixture({
      baseRuntime: "# Runtime\n\nPublish with ClawHub.\n",
      currentRuntime: "# Runtime\n\nPublish with ClawHub.\n",
      upstreamRuntime: "# Runtime\n\nRuntime-only guidance.\n",
    });

    const result = updateSync(fixture.options);

    expect(result.conflicts).toEqual([]);
    expect(result.validationErrors).toEqual([
      "docs/plugins/runtime.md is missing required text: Publish with ClawHub.",
    ]);
    expect(readManifest(fixture.workspace).upstream.lastSyncedCommit).toBe(fixture.baseCommit);
    expect(JSON.parse(read(fixture.workspace, "docs/.openclaw-sync/pending.json"))).toMatchObject({
      targetCommit: fixture.targetCommit,
      validationErrors: result.validationErrors,
    });
  });

  it("treats upstream deletion of a mirrored document as a manual conflict", () => {
    const fixture = createFixture({ deleteUpstreamRuntime: true });

    const result = updateSync(fixture.options);

    expect(result.conflicts).toEqual(["docs/plugins/runtime.md"]);
    expect(read(fixture.workspace, "docs/plugins/runtime.md")).toContain("Publish with ClawHub.");
    expect(
      read(fixture.workspace, "docs/.openclaw-sync/conflicts/docs__plugins__runtime.md.diff3"),
    ).toContain("deleted upstream");
  });

  it("rejects manifests that let mirrored files overlap ClawHub-owned files", () => {
    const fixture = createFixture();
    const manifest = readManifest(fixture.workspace);
    manifest.clawhubOwned.push("docs/plugins/runtime.md");
    writeManifest(fixture.workspace, manifest);

    expect(() => loadSyncManifest({ repoRoot: fixture.workspace })).toThrow(
      /both mirrored and ClawHub-owned/,
    );
  });

  it("fails verification when required ClawHub guidance disappears", () => {
    const fixture = createFixture();
    write(fixture.workspace, "docs/plugins/runtime.md", "# Runtime\n\nRuntime behavior.\n");

    expect(() => verifySync(fixture.options)).toThrow(
      /missing required text.*Publish with ClawHub/,
    );
  });

  it("fails verification when a mirrored page gains an OpenClaw root-relative link", () => {
    const fixture = createFixture({ rejectRootRelativeLinks: true });
    write(
      fixture.workspace,
      "docs/plugins/runtime.md",
      "# Runtime\n\nPublish with ClawHub.\n\nSee [internal](/plugins/internal).\n",
    );

    expect(() => verifySync(fixture.options)).toThrow(/root-relative link/);
  });

  it("fails verification when a mirrored page contains unresolved diff3 markers", () => {
    const fixture = createFixture();
    write(
      fixture.workspace,
      "docs/plugins/runtime.md",
      [
        "# Runtime",
        "",
        "<<<<<<< ClawHub",
        "Publish with ClawHub.",
        "||||||| OpenClaw sync base",
        "Runtime behavior.",
        "=======",
        "Updated runtime behavior.",
        ">>>>>>> OpenClaw target",
        "",
      ].join("\n"),
    );

    expect(() => verifySync(fixture.options)).toThrow(/merge conflict markers/);
  });
});

function createFixture({
  baseRuntime = "# Runtime\n\nRuntime behavior.\n",
  currentRuntime = "# Runtime\n\nRuntime behavior.\n\nPublish with ClawHub.\n",
  upstreamRuntime = baseRuntime,
  baseWatch = "# Skills\n\nRuntime guidance.\n",
  currentWatch = "# ClawHub skills\n\nRegistry guidance.\n",
  upstreamWatch = baseWatch,
  deleteUpstreamRuntime = false,
  rejectRootRelativeLinks = false,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clawhub-docs-sync-"));
  const sourceRepo = path.join(root, "openclaw");
  const workspace = path.join(root, "clawhub");
  fs.mkdirSync(sourceRepo, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });

  git(sourceRepo, ["init", "-b", "main"]);
  git(sourceRepo, ["config", "user.name", "Docs Sync Test"]);
  git(sourceRepo, ["config", "user.email", "docs-sync@example.invalid"]);
  write(sourceRepo, "docs/plugins/runtime.md", baseRuntime);
  write(sourceRepo, "docs/tools/skills.md", baseWatch);
  git(sourceRepo, ["add", "."]);
  git(sourceRepo, ["commit", "-m", "base"]);
  const baseCommit = git(sourceRepo, ["rev-parse", "HEAD"]);

  if (deleteUpstreamRuntime) {
    fs.rmSync(path.join(sourceRepo, "docs/plugins/runtime.md"));
  } else {
    write(sourceRepo, "docs/plugins/runtime.md", upstreamRuntime);
  }
  write(sourceRepo, "docs/tools/skills.md", upstreamWatch);
  git(sourceRepo, ["add", "."]);
  git(sourceRepo, ["commit", "--allow-empty", "-m", "target"]);
  const targetCommit = git(sourceRepo, ["rev-parse", "HEAD"]);

  write(workspace, "docs/plugins/runtime.md", currentRuntime);
  write(workspace, "docs/creating-skills.md", currentWatch);
  writeManifest(workspace, {
    schemaVersion: 1,
    upstream: {
      repository: sourceRepo,
      branch: "main",
      lastSyncedCommit: baseCommit,
    },
    mirrors: [
      {
        source: "docs/plugins/runtime.md",
        target: "docs/plugins/runtime.md",
      },
    ],
    watchOnly: ["docs/tools/skills.md"],
    clawhubOwned: ["docs/creating-skills.md"],
    linkPolicy: {
      rejectRootRelative: rejectRootRelativeLinks,
    },
    flavourChecks: [
      {
        path: "docs/plugins/runtime.md",
        includes: ["Publish with ClawHub."],
      },
    ],
  });

  return {
    baseCommit,
    options: {
      repoRoot: workspace,
      sourceRepoDir: sourceRepo,
      targetRef: targetCommit,
    },
    sourceRepo,
    targetCommit,
    workspace,
  };
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function readManifest(root) {
  return JSON.parse(read(root, "scripts/docs-sync/openclaw-plugin-docs.json"));
}

function writeManifest(root, value) {
  write(root, "scripts/docs-sync/openclaw-plugin-docs.json", `${JSON.stringify(value, null, 2)}\n`);
}

function write(root, rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
