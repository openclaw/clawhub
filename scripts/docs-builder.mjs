#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultStageRoot = path.join(repoRoot, ".cache", "openclaw-docs-clawhub");
const defaultOutputDir = path.join(repoRoot, "public", "docs");
const require = createRequire(import.meta.url);

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
  exists = fs.existsSync,
  resolvePackageRoot = resolveInstalledOpenClawDocsRepo,
} = {}) {
  const explicit = env.OPENCLAW_DOCS_REPO_DIR?.trim();
  if (explicit) {
    const docsRepoDir = path.resolve(cwd, explicit);
    if (isOpenClawDocsRepo(docsRepoDir, exists)) return docsRepoDir;
    throw new Error(`${docsRepoDir} is not an openclaw/docs checkout`);
  }

  const installed = resolvePackageRoot();
  if (installed && isOpenClawDocsRepo(installed, exists)) return installed;

  throw new Error(
    "ClawHub docs need openclaw/docs. Install the openclaw-docs-site package or set OPENCLAW_DOCS_REPO_DIR to a local openclaw/docs checkout.",
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
  ensureOpenClawDocsRepo(docsRepoDir);
  ensureBuilderDependencies(docsRepoDir);
  prepareStage({ docsRepoDir, stageRoot, cwd });
  runBuilderPipeline({ docsRepoDir, stageRoot, cwd, commandRunner, env });
  copyGeneratedDocs({ stageRoot, outputDir });
  console.log(`ClawHub docs built with openclaw/docs: ${path.relative(cwd, outputDir)}`);
}

export function ensureOpenClawDocsRepo(docsRepoDir) {
  if (!isOpenClawDocsRepo(docsRepoDir, fs.existsSync)) {
    throw new Error(`${docsRepoDir} is not an openclaw/docs checkout`);
  }
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

  const nodeModulesDir = resolveBuilderNodeModules(docsRepoDir);
  symlinkOrCopy(nodeModulesDir, path.join(stageRoot, "node_modules"));

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
    resolveBuilderBin(docsRepoDir, pagefindBinName()),
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

function ensureBuilderDependencies(docsRepoDir) {
  resolveBuilderBin(docsRepoDir, pagefindBinName());
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

function resolveInstalledOpenClawDocsRepo() {
  try {
    return path.dirname(require.resolve("openclaw-docs-site/package.json"));
  } catch {
    return "";
  }
}

function resolveBuilderNodeModules(docsRepoDir) {
  const candidates = [
    path.join(docsRepoDir, "node_modules"),
    path.join(path.dirname(docsRepoDir), "node_modules"),
    path.join(repoRoot, "node_modules"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not find node_modules for openclaw/docs at ${docsRepoDir}. Run bun install in ClawHub or install dependencies in the local openclaw/docs checkout.`,
  );
}

function resolveBuilderBin(docsRepoDir, name) {
  const candidates = [
    path.join(docsRepoDir, "node_modules", ".bin", name),
    path.join(path.dirname(docsRepoDir), ".bin", name),
    path.join(path.dirname(docsRepoDir), "node_modules", ".bin", name),
    path.join(repoRoot, "node_modules", ".bin", name),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not find ${name} for openclaw/docs at ${docsRepoDir}. Run bun install in ClawHub or install dependencies in the local openclaw/docs checkout.`,
  );
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
