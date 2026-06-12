#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultStageRoot = path.join(repoRoot, ".cache", "openclaw-docs-clawhub");
const defaultOutputDir = path.join(repoRoot, "public", "docs");

export function planDocsStage(sourceRels) {
  return sourceRels
    .map((sourceRel) => normalizeRel(sourceRel))
    .filter(Boolean)
    .filter((sourceRel) => !shouldIgnoreSourceDoc(sourceRel))
    .map((sourceRel) => ({
      sourceRel,
      stageRel: stageRelFor(sourceRel),
      injectSourcePath: sourcePathFor(sourceRel),
    }))
    .sort((a, b) => a.stageRel.localeCompare(b.stageRel));
}

export function resolveOpenClawDocsRepo({
  env = process.env,
  cwd = repoRoot,
  homedir = os.homedir(),
  exists = fs.existsSync,
} = {}) {
  const explicit = env.OPENCLAW_DOCS_REPO_DIR?.trim();
  const candidates = [
    explicit ? path.resolve(cwd, explicit) : "",
    path.resolve(cwd, "..", "docs"),
    path.resolve(cwd, "..", "..", "docs"),
    path.join(homedir, "Git", "openclaw", "docs"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isOpenClawDocsRepo(candidate, exists)) return candidate;
  }

  return path.resolve(
    cwd,
    env.OPENCLAW_DOCS_REPO_CHECKOUT_DIR?.trim() || path.join(".cache", "openclaw-docs-checkout"),
  );
}

export function buildDocs({
  cwd = repoRoot,
  docsRepoDir = resolveOpenClawDocsRepo({ cwd }),
  outputDir = defaultOutputDir,
  stageRoot = defaultStageRoot,
  commandRunner = runCommand,
  env = process.env,
} = {}) {
  ensureOpenClawDocsCheckout(docsRepoDir, commandRunner, env);
  ensureBuilderDependencies(docsRepoDir, commandRunner, env);
  prepareStage({ docsRepoDir, stageRoot, cwd });
  runBuilderPipeline({ docsRepoDir, stageRoot, cwd, commandRunner, env });
  copyGeneratedDocs({ stageRoot, outputDir });
  console.log(`ClawHub docs built with openclaw/docs: ${path.relative(cwd, outputDir)}`);
}

export function ensureOpenClawDocsCheckout(docsRepoDir, commandRunner, env) {
  const ref = env.OPENCLAW_DOCS_REPO_REF?.trim();
  if (isOpenClawDocsRepo(docsRepoDir, fs.existsSync)) {
    if (ref) checkoutOpenClawDocsRef(docsRepoDir, ref, commandRunner, env);
    return;
  }
  if (fs.existsSync(docsRepoDir) && fs.readdirSync(docsRepoDir).length > 0) {
    throw new Error(`${docsRepoDir} exists but is not an openclaw/docs checkout`);
  }

  fs.mkdirSync(path.dirname(docsRepoDir), { recursive: true });
  const repoUrl = env.OPENCLAW_DOCS_REPO_URL?.trim() || "https://github.com/openclaw/docs.git";
  commandRunner("git", ["clone", "--depth", "1", repoUrl, docsRepoDir], { cwd: repoRoot, env });

  if (ref) checkoutOpenClawDocsRef(docsRepoDir, ref, commandRunner, env);

  if (!isOpenClawDocsRepo(docsRepoDir, fs.existsSync)) {
    throw new Error(`${docsRepoDir} is not an openclaw/docs checkout after clone`);
  }
}

function checkoutOpenClawDocsRef(docsRepoDir, ref, commandRunner, env) {
  commandRunner("git", ["fetch", "--depth", "1", "origin", ref], { cwd: docsRepoDir, env });
  commandRunner("git", ["checkout", "FETCH_HEAD"], { cwd: docsRepoDir, env });
}

function prepareStage({ docsRepoDir, stageRoot, cwd }) {
  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(stageRoot, "docs"), { recursive: true });
  fs.mkdirSync(path.join(stageRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(stageRoot, ".openclaw-sync"), { recursive: true });

  symlinkOrCopy(
    path.join(docsRepoDir, "scripts", "docs-site"),
    path.join(stageRoot, "scripts", "docs-site"),
  );
  symlinkOrCopy(path.join(docsRepoDir, "node_modules"), path.join(stageRoot, "node_modules"));

  const docsSourceDir = path.join(cwd, "docs");
  const entries = planDocsStage(listFiles(docsSourceDir));
  for (const entry of entries) {
    const source = path.join(docsSourceDir, entry.sourceRel);
    const target = path.join(stageRoot, "docs", entry.stageRel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (entry.injectSourcePath) {
      fs.writeFileSync(
        target,
        injectSourcePath(fs.readFileSync(source, "utf8"), entry.injectSourcePath),
        "utf8",
      );
    } else {
      fs.copyFileSync(source, target);
    }
  }

  fs.writeFileSync(
    path.join(stageRoot, ".openclaw-sync", "source.json"),
    `${JSON.stringify(sourceMetadata(cwd), null, 2)}\n`,
    "utf8",
  );
}

function runBuilderPipeline({ docsRepoDir, stageRoot, cwd, commandRunner, env }) {
  const sourceRepoDir = env.DOCS_SOURCE_REPO_DIR?.trim() || cwd;
  const builderEnv = {
    ...env,
    DOCS_SITE_BASE_PATH: "/docs",
    DOCS_SITE_LEGACY_BASE_PATH: "",
    DOCS_SITE_CANONICAL_ORIGIN: "https://clawhub.ai/docs",
    DOCS_SITE_CHAT_AUTH_URL: "/auth/docs",
    DOCS_FEEDBACK_ISSUE_REPO: "openclaw/clawhub",
    DOCS_SOURCE_REPO_DIR: sourceRepoDir,
    DOCS_SOURCE_REPO_URL: "https://github.com/openclaw/clawhub",
  };

  const nodeScripts = [
    "build.mjs",
    "search-index.mjs",
    "source-index.mjs",
    "pagefind-normalize.mjs",
  ];

  for (const script of nodeScripts.slice(0, 3)) {
    commandRunner("node", [path.join(docsRepoDir, "scripts", "docs-site", script)], {
      cwd: stageRoot,
      env: builderEnv,
    });
  }

  commandRunner(
    path.join(docsRepoDir, "node_modules", ".bin", pagefindBinName()),
    [
      "--site",
      path.join(stageRoot, "dist", "docs-site"),
      "--output-path",
      path.join(stageRoot, "dist", "docs-site", "pagefind"),
    ],
    { cwd: stageRoot, env: builderEnv },
  );

  commandRunner(
    "node",
    [path.join(docsRepoDir, "scripts", "docs-site", "pagefind-normalize.mjs")],
    {
      cwd: stageRoot,
      env: builderEnv,
    },
  );
}

function ensureBuilderDependencies(docsRepoDir, commandRunner, env) {
  const nodeModules = path.join(docsRepoDir, "node_modules");
  const pagefindBin = path.join(nodeModules, ".bin", pagefindBinName());
  if (fs.existsSync(pagefindBin)) return;
  commandRunner("npm", ["ci"], { cwd: docsRepoDir, env });
}

function copyGeneratedDocs({ stageRoot, outputDir }) {
  const built = path.join(stageRoot, "dist", "docs-site");
  if (!fs.existsSync(path.join(built, "index.html"))) {
    throw new Error(
      `openclaw/docs did not produce ${path.relative(repoRoot, path.join(built, "index.html"))}`,
    );
  }
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  fs.cpSync(built, outputDir, { recursive: true });
}

function shouldIgnoreSourceDoc(sourceRel) {
  return (
    sourceRel === "README.md" ||
    sourceRel === "AGENTS.md" ||
    sourceRel.startsWith("specs/") ||
    sourceRel.startsWith(".")
  );
}

function stageRelFor(sourceRel) {
  if (sourceRel === "clawhub.md") return "index.md";
  return sourceRel;
}

function sourcePathFor(sourceRel) {
  if (!/\.(md|mdx)$/u.test(sourceRel)) return null;
  if (sourceRel === "clawhub.md") return "clawhub/index.md";
  return `clawhub/${sourceRel}`;
}

function injectSourcePath(markdown, sourcePath) {
  const sourceYaml = `x-i18n:\n  source_path: ${JSON.stringify(sourcePath)}\n`;
  if (markdown.startsWith("---\n")) return markdown.replace("---\n", `---\n${sourceYaml}`);
  return `---\n${sourceYaml}---\n\n${markdown}`;
}

function sourceMetadata(cwd) {
  const sha = git(["rev-parse", "HEAD"], cwd) || null;
  return {
    repository: "openclaw/clawhub",
    sha,
    sources: {
      clawhub: {
        repository: "openclaw/clawhub",
        sha,
      },
    },
  };
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function listFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const child of listFiles(full)) files.push(path.join(entry.name, child));
    } else if (entry.isFile()) {
      files.push(entry.name);
    }
  }
  return files.map((file) => normalizeRel(file)).sort();
}

function symlinkOrCopy(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  try {
    fs.symlinkSync(source, target, "junction");
  } catch {
    fs.cpSync(source, target, { recursive: true });
  }
}

function isOpenClawDocsRepo(candidate, exists) {
  if (!exists(path.join(candidate, "package.json"))) return false;
  if (!exists(path.join(candidate, "scripts", "docs-site", "build.mjs"))) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(candidate, "package.json"), "utf8"));
    return pkg.name === "openclaw-docs-site";
  } catch {
    return false;
  }
}

function normalizeRel(value) {
  const rel = String(value).replaceAll("\\", "/").replace(/^\/+/, "");
  const normalized = path.posix.normalize(rel);
  return normalized === "." || normalized.startsWith("../") ? "" : normalized;
}

function pagefindBinName() {
  return process.platform === "win32" ? "pagefind.cmd" : "pagefind";
}

function runCommand(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
}

if (process.argv[1] === scriptPath) {
  buildDocs();
}
