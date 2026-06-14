/* @vitest-environment node */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureOpenClawDocsRepo, planDocsStage, resolveOpenClawDocsRepo } from "./docs-builder.mjs";

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

  it("resolves an explicit openclaw/docs checkout", () => {
    const docsRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawhub-openclaw-docs-"));
    fs.mkdirSync(path.join(docsRepoDir, "scripts", "docs-site"), { recursive: true });
    fs.writeFileSync(
      path.join(docsRepoDir, "package.json"),
      `${JSON.stringify({ name: "openclaw-docs-site" })}\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(docsRepoDir, "scripts", "docs-site", "build.mjs"), "", "utf8");

    expect(
      resolveOpenClawDocsRepo({
        cwd: "/repo/clawhub",
        env: { OPENCLAW_DOCS_REPO_DIR: docsRepoDir },
        homedir: "/home/me",
      }),
    ).toBe(docsRepoDir);
  });

  it("resolves the installed openclaw-docs-site package when no checkout is explicit", () => {
    const docsRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawhub-openclaw-docs-"));
    fs.mkdirSync(path.join(docsRepoDir, "scripts", "docs-site"), { recursive: true });
    fs.writeFileSync(
      path.join(docsRepoDir, "package.json"),
      `${JSON.stringify({ name: "openclaw-docs-site" })}\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(docsRepoDir, "scripts", "docs-site", "build.mjs"), "", "utf8");

    expect(
      resolveOpenClawDocsRepo({
        cwd: "/repo/clawhub",
        env: {},
        homedir: "/home/me",
        resolvePackageRoot: () => docsRepoDir,
      }),
    ).toBe(docsRepoDir);
  });

  it("fails when neither an explicit checkout nor installed package is available", () => {
    expect(() =>
      resolveOpenClawDocsRepo({
        cwd: "/repo/clawhub",
        env: {},
        exists: () => false,
        homedir: "/home/me",
        resolvePackageRoot: () => "",
      }),
    ).toThrow(/OPENCLAW_DOCS_REPO_DIR/);
  });

  it("rejects invalid openclaw/docs roots instead of cloning one", () => {
    const invalidDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawhub-not-docs-"));
    fs.writeFileSync(path.join(invalidDir, "package.json"), "{}\n", "utf8");

    expect(() => ensureOpenClawDocsRepo(invalidDir)).toThrow(/not an openclaw\/docs checkout/);
  });
});
