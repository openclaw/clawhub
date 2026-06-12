/* @vitest-environment node */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureOpenClawDocsCheckout,
  planDocsStage,
  resolveOpenClawDocsRepo,
} from "./docs-builder.mjs";

describe("docs-builder", () => {
  it("stages ClawHub docs in the shape expected by openclaw/docs", () => {
    const entries = planDocsStage([
      "README.md",
      "assets/clawd-logo.png",
      "clawhub.md",
      "docs.json",
      "quickstart.md",
      "specs/private.md",
    ]);

    expect(entries).toEqual([
      {
        injectSourcePath: null,
        sourceRel: "assets/clawd-logo.png",
        stageRel: "assets/clawd-logo.png",
      },
      { injectSourcePath: null, sourceRel: "docs.json", stageRel: "docs.json" },
      {
        injectSourcePath: "clawhub/index.md",
        sourceRel: "clawhub.md",
        stageRel: "index.md",
      },
      {
        injectSourcePath: "clawhub/quickstart.md",
        sourceRel: "quickstart.md",
        stageRel: "quickstart.md",
      },
    ]);
  });

  it("uses the managed checkout path when no local openclaw/docs checkout exists", () => {
    expect(
      resolveOpenClawDocsRepo({
        cwd: "/repo/clawhub",
        env: {},
        exists: () => false,
        homedir: "/home/me",
      }),
    ).toBe("/repo/clawhub/.cache/openclaw-docs-checkout");
  });

  it("checks out the requested docs ref even when the checkout already exists", () => {
    const docsRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawhub-openclaw-docs-"));
    fs.mkdirSync(path.join(docsRepoDir, "scripts", "docs-site"), { recursive: true });
    fs.writeFileSync(
      path.join(docsRepoDir, "package.json"),
      `${JSON.stringify({ name: "openclaw-docs-site" })}\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(docsRepoDir, "scripts", "docs-site", "build.mjs"), "", "utf8");

    const commands = [];
    ensureOpenClawDocsCheckout(
      docsRepoDir,
      (command, args, options) => commands.push({ args, command, cwd: options.cwd }),
      { OPENCLAW_DOCS_REPO_REF: "refs/pull/123/head" },
    );

    expect(commands).toEqual([
      {
        args: ["fetch", "--depth", "1", "origin", "refs/pull/123/head"],
        command: "git",
        cwd: docsRepoDir,
      },
      { args: ["checkout", "FETCH_HEAD"], command: "git", cwd: docsRepoDir },
    ]);
  });
});
