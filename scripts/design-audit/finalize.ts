import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parseFindings,
  renderAuditMarkdown,
  renderPullRequestBody,
  shouldOpenAuditPullRequest,
  sortAndDedupeFindings,
  summarizeFindings,
  type AuditReport,
} from "./report";

const validationCommands = [
  "bun run test:ui-contract",
  "bun run ci:static",
  "bun run ci:unit",
  "bun run ci:types-build",
  "bun run ci:playwright-smoke",
];

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function git(...args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function validateSafeChanges(paths: string[], numstat: string) {
  if (paths.length > 12) throw new Error(`audit changed ${paths.length} files; maximum is 12`);
  for (const path of paths) {
    if (!/^src\/.+\.(css|ts|tsx)$/.test(path)) {
      throw new Error(`audit attempted a change outside existing frontend source: ${path}`);
    }
  }
  const changedLines = numstat
    .split("\n")
    .filter(Boolean)
    .reduce((total, line) => {
      const [added, removed] = line.split("\t");
      return total + Number(added || 0) + Number(removed || 0);
    }, 0);
  if (changedLines > 400) {
    throw new Error(`audit changed ${changedLines} lines; maximum is 400`);
  }
}

export function validateCurrentSafeChanges() {
  const changedFiles = git("diff", "--name-only", "HEAD").split("\n").filter(Boolean);
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean);
  if (untracked.length > 0) {
    throw new Error(`audit created untracked files: ${untracked.join(", ")}`);
  }
  validateSafeChanges(changedFiles, git("diff", "--numstat", "HEAD"));
  return changedFiles;
}

async function main() {
  const deterministicPath = argument("--deterministic");
  const codexPath = argument("--codex");
  const browserPath = argument("--browser");
  const outputDirectory = argument("--output-directory");
  const release = argument("--release");
  const baseSha = argument("--base-sha");
  const consumerSha = argument("--consumer-sha");
  const validationPassed = argument("--validation-passed") === "true";
  const runUrl = argument("--run-url") ?? "local";
  if (
    !deterministicPath ||
    !codexPath ||
    !browserPath ||
    !outputDirectory ||
    !release ||
    !baseSha ||
    !consumerSha
  ) {
    throw new Error("missing required design-audit finalize argument");
  }

  const changedFiles = validateCurrentSafeChanges();

  const deterministic = JSON.parse(await readFile(deterministicPath, "utf8"));
  const codex = JSON.parse(await readFile(codexPath, "utf8"));
  const browser = JSON.parse(await readFile(browserPath, "utf8")) as {
    routes: string[];
    evidence: Array<{ screenshot: string }>;
  };
  const findings = sortAndDedupeFindings([
    ...parseFindings(deterministic),
    ...parseFindings(codex),
  ]);
  const report: AuditReport = {
    designSystemVersion: release,
    consumerSha,
    auditBaseSha: baseSha,
    generatedAt: new Date().toISOString(),
    summary: summarizeFindings(findings),
    findings,
    changedFiles,
    validationCommands,
    renderedRoutes: browser.routes,
    screenshotPaths: browser.evidence.map((entry) => entry.screenshot),
    validationPassed,
  };

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, "design-audit.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(join(outputDirectory, "design-audit.md"), renderAuditMarkdown(report));
  await writeFile(
    join(outputDirectory, "pull-request-body.md"),
    renderPullRequestBody(report, runUrl),
  );

  const openPullRequest = validationPassed && shouldOpenAuditPullRequest(report.summary);
  if (openPullRequest) {
    const committedDirectory = "design-audits/latest";
    await mkdir(committedDirectory, { recursive: true });
    const committedJson = join(committedDirectory, "design-audit.json");
    await writeFile(committedJson, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(join(committedDirectory, "design-audit.md"), renderAuditMarkdown(report));
    execFileSync("bunx", ["oxfmt", "--write", committedJson], { stdio: "inherit" });
  }

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    await mkdir(dirname(githubOutput), { recursive: true });
    await writeFile(
      githubOutput,
      [
        `open_pr=${openPullRequest}`,
        `has_fixes=${changedFiles.length > 0}`,
        `errors=${report.summary.errors}`,
        `warnings=${report.summary.warnings}`,
        `info=${report.summary.info}`,
        "",
      ].join("\n"),
      { flag: "a" },
    );
  }
  console.log(
    `finalized audit: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.info} info; PR=${openPullRequest}`,
  );
}

if (import.meta.main) {
  await main();
}
