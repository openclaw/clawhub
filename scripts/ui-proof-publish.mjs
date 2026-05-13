#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_ARTIFACT_BRANCH = "qa-artifacts";
const DEFAULT_MARKER = "<!-- clawhub-ui-proof -->";
const DEFAULT_REPO = "openclaw/clawhub";

export function parseProofPublishArgs(argv = []) {
  const opts = {
    artifactBranch: DEFAULT_ARTIFACT_BRANCH,
    marker: DEFAULT_MARKER,
    repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--") {
      continue;
    }
    if (arg === "--artifact-branch") {
      opts.artifactBranch = requireValue(arg, next);
      index += 1;
    } else if (arg === "--artifact-root") {
      opts.artifactRoot = requireValue(arg, next);
      index += 1;
    } else if (arg === "--artifact-url") {
      opts.artifactUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--marker") {
      opts.marker = requireValue(arg, next);
      index += 1;
    } else if (arg === "--proof-dir") {
      opts.proofDir = requireValue(arg, next);
      index += 1;
    } else if (arg === "--repo") {
      opts.repo = requireValue(arg, next);
      index += 1;
    } else if (arg === "--request-source") {
      opts.requestSource = requireValue(arg, next);
      index += 1;
    } else if (arg === "--run-url") {
      opts.runUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--target-pr") {
      opts.targetPr = requireValue(arg, next);
      index += 1;
    } else {
      throw new Error(`Unknown proof:publish argument: ${arg}`);
    }
  }
  if (!opts.proofDir) throw new Error("proof:publish requires --proof-dir <path>");
  if (!opts.targetPr) throw new Error("proof:publish requires --target-pr <number>");
  if (!/^[0-9]+$/u.test(opts.targetPr)) {
    throw new Error(`--target-pr must be numeric, got ${opts.targetPr}`);
  }
  return opts;
}

function requireValue(flag, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assertInside(parentDir, candidatePath, label) {
  const relative = path.relative(parentDir, candidatePath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return candidatePath;
  }
  throw new Error(`${label} escapes proof directory: ${candidatePath}`);
}

function normalizeTargetPath(targetPath) {
  const normalized = path.posix.normalize(String(targetPath).replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized === "" ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized)
  ) {
    throw new Error(`Invalid artifact target path: ${targetPath}`);
  }
  return normalized;
}

function encodePathForUrl(input) {
  return input
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function artifactUrl(rawBase, artifact) {
  return `${rawBase}/${encodePathForUrl(artifact.targetPath)}`;
}

function relativeArtifactPath(proofDir, sourcePath, label) {
  const source = assertInside(proofDir, path.resolve(sourcePath), label);
  if (!existsSync(source)) return undefined;
  if (!statSync(source).isFile()) {
    throw new Error(`${label} is not a file: ${sourcePath}`);
  }
  return source;
}

function pushArtifact(artifacts, proofDir, artifact) {
  const source = relativeArtifactPath(
    proofDir,
    path.resolve(proofDir, artifact.path),
    artifact.label ?? artifact.path,
  );
  if (!source) {
    if (artifact.required === false) return;
    throw new Error(`Missing required artifact: ${artifact.path}`);
  }
  artifacts.push({
    ...artifact,
    label: artifact.label ?? artifact.path,
    source,
    targetPath: normalizeTargetPath(artifact.targetPath ?? artifact.path),
  });
}

export async function buildUiProofEvidence({ proofDir }) {
  const resolvedProofDir = path.resolve(proofDir);
  const summaryPath = path.join(resolvedProofDir, "summary.json");
  const reportPath = path.join(resolvedProofDir, "report.md");
  const summary = readJson(summaryPath);
  if (summary.status === "dry-run") {
    throw new Error("proof:publish requires a non-dry-run proof directory");
  }

  const artifacts = [];
  pushArtifact(artifacts, resolvedProofDir, {
    kind: "metadata",
    label: "ClawHub UI proof summary",
    path: "summary.json",
    targetPath: "summary.json",
  });
  pushArtifact(artifacts, resolvedProofDir, {
    kind: "report",
    label: "ClawHub UI proof report",
    path: "report.md",
    required: existsSync(reportPath),
    targetPath: "report.md",
  });

  for (const lane of summary.lanes ?? []) {
    for (const [index, step] of (lane.steps ?? []).entries()) {
      if (!step.screenshot) continue;
      const targetName = `${step.slug || `step-${index + 1}`}.png`;
      pushArtifact(artifacts, resolvedProofDir, {
        alt: step.name,
        index,
        kind: "screenshot",
        label: step.name,
        lane: lane.name,
        path: path.posix.join(lane.name, step.screenshot.replaceAll("\\", "/")),
        status: step.status,
        targetPath: path.posix.join(lane.name, targetName),
        width: 420,
      });
    }
    const videoPath = lane.videoPath
      ? path.relative(resolvedProofDir, lane.videoPath).replaceAll("\\", "/")
      : path.posix.join(lane.name, "full-run.mp4");
    pushArtifact(artifacts, resolvedProofDir, {
      kind: "fullVideo",
      label: `${lane.name} full run`,
      lane: lane.name,
      path: videoPath,
      required: false,
      targetPath: path.posix.join(lane.name, "full-run.mp4"),
    });
    pushArtifact(artifacts, resolvedProofDir, {
      alt: `${lane.name} full run preview`,
      kind: "videoPreview",
      label: `${lane.name} full run preview`,
      lane: lane.name,
      path: path.posix.join(lane.name, "full-run.gif"),
      required: false,
      targetPath: path.posix.join(lane.name, "full-run.gif"),
      width: 720,
    });
  }

  return {
    artifacts,
    proofDir: resolvedProofDir,
    summary,
  };
}

function artifactsByLane(evidence, kind) {
  const lanes = new Map();
  for (const artifact of evidence.artifacts) {
    if (artifact.kind !== kind || !artifact.lane) continue;
    const lane = lanes.get(artifact.lane) ?? [];
    lane.push(artifact);
    lanes.set(artifact.lane, lane);
  }
  for (const lane of lanes.values()) {
    lane.sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0));
  }
  return lanes;
}

function renderBeforeAfterScreenshots({ evidence, rawBase }) {
  const lanes = artifactsByLane(evidence, "screenshot");
  const baseline = lanes.get("baseline") ?? [];
  const candidate = lanes.get("candidate") ?? [];
  const rows = [];
  const count = Math.max(baseline.length, candidate.length);
  for (let index = 0; index < count; index += 1) {
    const left = baseline[index];
    const right = candidate[index];
    if (!left || !right) continue;
    const width = Math.min(Number(left.width ?? right.width ?? 420) || 420, 720);
    rows.push(
      `| ${left.label} | ${right.label} |`,
      "| --- | --- |",
      `| <img src="${artifactUrl(rawBase, left)}" width="${width}" alt="${left.alt ?? left.label}"> | <img src="${artifactUrl(rawBase, right)}" width="${width}" alt="${right.alt ?? right.label}"> |`,
      "",
    );
  }
  return rows.join("\n");
}

function renderFeatureScreenshots({ evidence, rawBase }) {
  return evidence.artifacts
    .filter((artifact) => artifact.kind === "screenshot")
    .map((artifact) => {
      const width = Math.min(Number(artifact.width ?? 720) || 720, 900);
      return [
        `**${artifact.label}**`,
        "",
        `<img src="${artifactUrl(rawBase, artifact)}" width="${width}" alt="${artifact.alt ?? artifact.label}">`,
        "",
      ].join("\n");
    })
    .join("\n");
}

function renderVideoLinks({ evidence, rawBase }) {
  const links = evidence.artifacts
    .filter((artifact) => artifact.kind === "fullVideo")
    .map((artifact) => `- [${artifact.label}](${artifactUrl(rawBase, artifact)})`);
  return links.length ? ["Full videos:", ...links, ""].join("\n") : "";
}

function renderVideoPreviews({ evidence, rawBase }) {
  const previews = evidence.artifacts.filter((artifact) => artifact.kind === "videoPreview");
  if (!previews.length) return "";
  return [
    "Inline video previews:",
    "",
    ...previews.map((artifact) => {
      const width = Math.min(Number(artifact.width ?? 720) || 720, 900);
      return [
        `**${artifact.label}**`,
        "",
        `<img src="${artifactUrl(rawBase, artifact)}" width="${width}" alt="${artifact.alt ?? artifact.label}">`,
        "",
      ].join("\n");
    }),
  ].join("\n");
}

export function renderUiProofComment({
  artifactRoot,
  artifactUrl: actionsArtifactUrl,
  evidence,
  marker,
  rawBase,
  requestSource,
  runUrl,
  treeUrl,
}) {
  const { summary } = evidence;
  const lines = [
    marker,
    "## ClawHub UI Proof",
    "",
    `Status: \`${summary.status ?? "unknown"}\``,
    `Mode: \`${summary.mode ?? "before-after"}\``,
    `Scenario: \`${summary.scenario ?? "unknown"}\``,
    `Provider: \`${summary.provider ?? "unknown"}\``,
  ];
  if (summary.mode === "feature") {
    lines.push("Baseline: not run for feature proof.");
  } else {
    lines.push(`Baseline: \`${summary.baseline ?? "origin/main"}\``);
  }
  lines.push(`Candidate: \`${summary.candidate ?? "worktree"}\``);
  if (requestSource) lines.push(`Trigger: \`${requestSource}\``);
  if (runUrl) lines.push(`Run: ${runUrl}`);
  if (actionsArtifactUrl) lines.push(`Actions artifact: ${actionsArtifactUrl}`);
  lines.push("");

  const screenshotSection =
    summary.mode === "feature"
      ? renderFeatureScreenshots({ evidence, rawBase })
      : renderBeforeAfterScreenshots({ evidence, rawBase });
  if (screenshotSection) lines.push(screenshotSection);
  const videoPreviews = renderVideoPreviews({ evidence, rawBase });
  if (videoPreviews) lines.push(videoPreviews);
  const videoLinks = renderVideoLinks({ evidence, rawBase });
  if (videoLinks) lines.push(videoLinks);
  lines.push(
    `Raw proof files: ${treeUrl ?? `https://github.com/${process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO}/tree/qa-artifacts/${artifactRoot}`}`,
  );
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n")}\n`;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "inherit"],
    ...options,
  });
}

function runStatus(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "ignore",
    ...options,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function remoteUrl(repo) {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  return token
    ? `https://x-access-token:${token}@github.com/${repo}.git`
    : `https://github.com/${repo}.git`;
}

function publishArtifactFiles({ artifactBranch, artifactRoot, evidence, repo }) {
  const worktree = mkdtempSync(path.join(tmpdir(), "clawhub-ui-proof-artifacts-"));
  const safeArtifactRoot = normalizeTargetPath(artifactRoot);
  try {
    run("git", ["init", "--quiet", worktree]);
    run("git", ["-C", worktree, "config", "user.name", "github-actions[bot]"]);
    run("git", [
      "-C",
      worktree,
      "config",
      "user.email",
      "41898282+github-actions[bot]@users.noreply.github.com",
    ]);
    run("git", ["-C", worktree, "remote", "add", "origin", remoteUrl(repo)]);
    try {
      run("git", ["-C", worktree, "fetch", "--quiet", "origin", artifactBranch]);
      run("git", ["-C", worktree, "checkout", "--quiet", "-B", artifactBranch, "FETCH_HEAD"]);
    } catch {
      run("git", ["-C", worktree, "checkout", "--quiet", "--orphan", artifactBranch]);
    }

    const destinationRoot = path.join(worktree, safeArtifactRoot);
    for (const artifact of evidence.artifacts) {
      const destination = assertInside(
        destinationRoot,
        path.resolve(destinationRoot, artifact.targetPath),
        `Artifact target ${artifact.targetPath}`,
      );
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(artifact.source, destination);
    }

    run("git", ["-C", worktree, "add", safeArtifactRoot]);
    const hasChanges = runStatus("git", ["-C", worktree, "diff", "--cached", "--quiet"]) !== 0;
    if (hasChanges) {
      run("git", [
        "-C",
        worktree,
        "commit",
        "--quiet",
        "-m",
        `qa: publish ClawHub UI proof for ${safeArtifactRoot}`,
      ]);
      run("git", ["-C", worktree, "push", "--quiet", "origin", `HEAD:${artifactBranch}`]);
    } else {
      console.log("No ClawHub UI proof artifact changes to publish.");
    }
  } finally {
    rmSync(worktree, { force: true, recursive: true });
  }
  return safeArtifactRoot;
}

function upsertPrComment({ body, marker, prNumber, repo }) {
  run("gh", ["api", `repos/${repo}/pulls/${prNumber}`, "--jq", ".number"]);
  const commentId = run("gh", [
    "api",
    "--paginate",
    `repos/${repo}/issues/${prNumber}/comments`,
    "--jq",
    `.[] | select(.body | contains("${marker}")) | .id`,
  ])
    .trim()
    .split("\n")
    .findLast((line) => line.length > 0);
  const bodyDir = mkdtempSync(path.join(tmpdir(), "clawhub-ui-proof-comment-"));
  const bodyFile = path.join(bodyDir, "body.md");
  writeFileSync(bodyFile, body);
  try {
    if (commentId) {
      const payloadFile = `${bodyFile}.json`;
      writeFileSync(payloadFile, JSON.stringify({ body }));
      try {
        run("gh", [
          "api",
          "--method",
          "PATCH",
          `repos/${repo}/issues/comments/${commentId}`,
          "--input",
          payloadFile,
        ]);
        console.log(`Updated ClawHub UI proof comment on PR #${prNumber}.`);
        return;
      } catch {
        console.warn(
          `Could not update existing ClawHub UI proof comment ${commentId}; creating a new one.`,
        );
      }
    }
    run("gh", ["pr", "comment", prNumber, "--repo", repo, "--body-file", bodyFile], {
      stdio: "inherit",
    });
    console.log(`Created ClawHub UI proof comment on PR #${prNumber}.`);
  } finally {
    rmSync(bodyDir, { force: true, recursive: true });
  }
}

function defaultArtifactRoot({ proofDir, targetPr }) {
  return normalizeTargetPath(
    path.posix.join("clawhub-ui-proof", `pr-${targetPr}`, path.basename(path.resolve(proofDir))),
  );
}

export async function publishUiProof(rawArgs = process.argv.slice(2)) {
  const opts = parseProofPublishArgs(rawArgs);
  const evidence = await buildUiProofEvidence({ proofDir: opts.proofDir });
  const artifactRoot = opts.artifactRoot ?? defaultArtifactRoot(opts);
  const rawBase = `https://raw.githubusercontent.com/${opts.repo}/${opts.artifactBranch}/${encodePathForUrl(artifactRoot)}`;
  const treeUrl = `https://github.com/${opts.repo}/tree/${opts.artifactBranch}/${encodePathForUrl(artifactRoot)}`;
  const body = renderUiProofComment({
    artifactRoot,
    artifactUrl: opts.artifactUrl,
    evidence,
    marker: opts.marker,
    rawBase,
    requestSource: opts.requestSource,
    runUrl: opts.runUrl,
    treeUrl,
  });
  if (opts.dryRun) {
    console.log(body);
    return { body, status: "dry-run" };
  }
  const publishedRoot = publishArtifactFiles({
    artifactBranch: opts.artifactBranch,
    artifactRoot,
    evidence,
    repo: opts.repo,
  });
  upsertPrComment({
    body,
    marker: opts.marker,
    prNumber: opts.targetPr,
    repo: opts.repo,
  });
  return { artifactRoot: publishedRoot, body, status: "published" };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishUiProof().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
