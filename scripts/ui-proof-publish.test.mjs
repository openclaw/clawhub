/* @vitest-environment node */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildUiProofEvidence,
  parseProofPublishArgs,
  renderUiProofComment,
} from "./ui-proof-publish.mjs";

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

async function fixtureProof({ mode = "before-after", status = "pass" } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "clawhub-proof-publish-"));
  tempDirs.push(dir);
  await fsp.mkdir(path.join(dir, "baseline", "screenshots"), { recursive: true });
  await fsp.mkdir(path.join(dir, "candidate", "screenshots"), { recursive: true });
  await fsp.writeFile(path.join(dir, "baseline", "screenshots", "skills.png"), "baseline");
  await fsp.writeFile(path.join(dir, "candidate", "screenshots", "skills.png"), "candidate");
  await fsp.writeFile(path.join(dir, "baseline", "full-run.gif"), "baseline gif");
  await fsp.writeFile(path.join(dir, "candidate", "full-run.gif"), "candidate gif");
  await fsp.writeFile(path.join(dir, "candidate", "full-run.mp4"), "video");
  await fsp.writeFile(path.join(dir, "report.md"), "# ClawHub UI Proof\nStatus: pass\n");
  await fsp.writeFile(
    path.join(dir, "summary.json"),
    `${JSON.stringify(
      {
        baseline: "origin/main",
        candidate: "worktree",
        generatedAt: "2026-05-13T12:00:00.000Z",
        lanes:
          mode === "feature"
            ? [
                {
                  name: "candidate",
                  ref: "worktree",
                  status,
                  steps: [
                    {
                      lane: "candidate",
                      name: "candidate skills page",
                      screenshot: "screenshots/skills.png",
                      slug: "skills",
                      status: "pass",
                    },
                  ],
                  videoPath: path.join(dir, "candidate", "full-run.mp4"),
                },
              ]
            : [
                {
                  name: "baseline",
                  ref: "origin/main",
                  status,
                  steps: [
                    {
                      lane: "baseline",
                      name: "baseline skills page",
                      screenshot: "screenshots/skills.png",
                      slug: "skills",
                      status: "pass",
                    },
                  ],
                },
                {
                  name: "candidate",
                  ref: "worktree",
                  status,
                  steps: [
                    {
                      lane: "candidate",
                      name: "candidate skills page",
                      screenshot: "screenshots/skills.png",
                      slug: "skills",
                      status: "pass",
                    },
                  ],
                  videoPath: path.join(dir, "candidate", "full-run.mp4"),
                },
              ],
        mode,
        outputDir: dir,
        provider: "hetzner",
        scenario: ".artifacts/proof-scenarios/demo.pw.ts",
        status,
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}

describe("ui-proof-publish", () => {
  it("parses publish defaults", () => {
    expect(
      parseProofPublishArgs(["--proof-dir", ".artifacts/proof", "--target-pr", "123"]),
    ).toMatchObject({
      artifactBranch: "qa-artifacts",
      marker: "<!-- clawhub-ui-proof -->",
      proofDir: ".artifacts/proof",
      repo: "openclaw/clawhub",
      targetPr: "123",
    });
  });

  it("renders before/after proof comments with inline screenshots and video links", async () => {
    const proofDir = await fixtureProof();
    const evidence = await buildUiProofEvidence({ proofDir });
    const body = renderUiProofComment({
      artifactRoot: "clawhub-ui-proof/pr-123/run",
      evidence,
      marker: "<!-- clawhub-ui-proof -->",
      rawBase:
        "https://raw.githubusercontent.com/openclaw/clawhub/qa-artifacts/clawhub-ui-proof/pr-123/run",
      treeUrl: "https://github.com/openclaw/clawhub/tree/qa-artifacts/clawhub-ui-proof/pr-123/run",
    });

    expect(body).toContain("<!-- clawhub-ui-proof -->");
    expect(body).toContain("Mode: `before-after`");
    expect(body).toContain("| baseline skills page | candidate skills page |");
    expect(body).toContain(
      '<img src="https://raw.githubusercontent.com/openclaw/clawhub/qa-artifacts/clawhub-ui-proof/pr-123/run/baseline/skills.png"',
    );
    expect(body).toContain("Inline video previews:");
    expect(body).toContain(
      '<img src="https://raw.githubusercontent.com/openclaw/clawhub/qa-artifacts/clawhub-ui-proof/pr-123/run/baseline/full-run.gif"',
    );
    expect(body).toContain(
      "[candidate full run](https://raw.githubusercontent.com/openclaw/clawhub/qa-artifacts/clawhub-ui-proof/pr-123/run/candidate/full-run.mp4)",
    );
  });

  it("renders feature proof comments with candidate-only screenshots", async () => {
    const proofDir = await fixtureProof({ mode: "feature" });
    const evidence = await buildUiProofEvidence({ proofDir });
    const body = renderUiProofComment({
      artifactRoot: "clawhub-ui-proof/pr-123/run",
      evidence,
      marker: "<!-- clawhub-ui-proof -->",
      rawBase:
        "https://raw.githubusercontent.com/openclaw/clawhub/qa-artifacts/clawhub-ui-proof/pr-123/run",
      treeUrl: "https://github.com/openclaw/clawhub/tree/qa-artifacts/clawhub-ui-proof/pr-123/run",
    });

    expect(body).toContain("Mode: `feature`");
    expect(body).toContain("**candidate skills page**");
    expect(body).toContain("<img ");
    expect(body).not.toContain("baseline skills page");
  });

  it("rejects dry-run proof directories", async () => {
    const proofDir = await fixtureProof({ status: "dry-run" });
    await expect(buildUiProofEvidence({ proofDir })).rejects.toThrow(
      "proof:publish requires a non-dry-run proof directory",
    );
  });
});
