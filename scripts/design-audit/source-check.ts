import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import type { AuditFinding } from "./report";

type AddedLine = {
  file: string;
  line: number;
  text: string;
};

const rawPaletteTokens: Record<string, string> = {
  "#101012": "--oc-bg-page",
  "#19191c": "--oc-bg-surface",
  "#202024": "--oc-bg-elevated",
  "#ededed": "--oc-text-primary",
  "#bcbcc4": "--oc-text-secondary",
  "#9a9aa2": "--oc-text-muted",
  "#f5654a": "--oc-accent-primary",
  "#d84a31": "--oc-accent-primary",
  "#4fc8ae": "--oc-accent-secondary",
  "#14806e": "--oc-accent-secondary",
};

const legacyAliases = new Set([
  "--bg",
  "--bg-soft",
  "--surface",
  "--surface-muted",
  "--ink",
  "--ink-soft",
  "--ink-muted",
  "--accent",
  "--accent-fg",
  "--accent-deep",
  "--seafoam",
  "--line",
  "--border-ui",
  "--input-bg",
  "--input-border",
]);

function git(...args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function parseAddedLines(diff: string): AddedLine[] {
  const lines = diff.split("\n");
  const added: AddedLine[] = [];
  let file = "";
  let nextLine = 0;

  for (const line of lines) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      nextLine = Number(hunk[1]);
      continue;
    }
    if (!file || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      added.push({ file, line: nextLine, text: line.slice(1) });
      nextLine += 1;
    } else if (!line.startsWith("-")) {
      nextLine += 1;
    }
  }
  return added;
}

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listSourceFiles(path);
      return [".css", ".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
    }),
  );
  return nested.flat();
}

function lineForOffset(source: string, offset: number) {
  return source.slice(0, offset).split("\n").length;
}

async function undefinedTokenFindings(designSystemStyles: string): Promise<AuditFinding[]> {
  const sourceFiles = await listSourceFiles("src");
  const packageFiles = await listSourceFiles(designSystemStyles);
  const definitions = new Set<string>();
  const references: Array<{ file: string; line: number; token: string }> = [];

  for (const path of [...sourceFiles, ...packageFiles]) {
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(/(--oc-[\w-]+)\s*:/g)) {
      definitions.add(match[1]!);
    }
    if (!path.startsWith("src/")) continue;
    for (const match of source.matchAll(/var\((--oc-[\w-]+)/g)) {
      references.push({
        file: relative(".", path),
        line: lineForOffset(source, match.index),
        token: match[1]!,
      });
    }
  }

  const firstByToken = new Map<string, (typeof references)[number]>();
  for (const reference of references) {
    if (!definitions.has(reference.token) && !firstByToken.has(reference.token)) {
      firstByToken.set(reference.token, reference);
    }
  }

  return [...firstByToken.values()].map((reference) => ({
    id: "token/undefined",
    severity: "error",
    kind: "mechanical",
    file: reference.file,
    line: reference.line,
    message: `${reference.token} is referenced but is not defined by ClawHub or the installed design system.`,
    remediation:
      "Define the semantic token in the owning layer or replace it with an existing token.",
    reference: "openclaw-design-system/references/tokens.md",
  }));
}

export function changedLineFindings(addedLines: AddedLine[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const added of addedLines) {
    if (!added.file.startsWith("src/")) continue;
    const normalized = added.text.toLowerCase();
    for (const [raw, token] of Object.entries(rawPaletteTokens)) {
      if (!normalized.includes(raw)) continue;
      findings.push({
        id: "token/raw-color",
        severity: "warning",
        kind: "mechanical",
        file: added.file,
        line: added.line,
        message: `A newly added raw OpenClaw palette value (${raw}) bypasses semantic theme intent.`,
        remediation: `Replace it with var(${token}) when that token matches the UI role.`,
        reference: "openclaw-design-system/references/tokens.md",
      });
    }
    for (const match of added.text.matchAll(/var\((--[\w-]+)/g)) {
      if (!legacyAliases.has(match[1]!)) continue;
      findings.push({
        id: "token/legacy-alias",
        severity: "warning",
        kind: "mechanical",
        file: added.file,
        line: added.line,
        message: `New code depends on migration-only alias ${match[1]}.`,
        remediation: "Use the equivalent canonical --oc-* semantic token.",
        reference: "openclaw-design-system/references/consumer-adapters.md",
      });
    }
  }
  return findings;
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  const baseIndex = process.argv.indexOf("--base");
  const stylesIndex = process.argv.indexOf("--design-system-styles");
  const workingTree = process.argv.includes("--working-tree");
  const failOnFindings = process.argv.includes("--fail-on-findings");
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined;
  const designSystemStyles =
    stylesIndex >= 0
      ? process.argv[stylesIndex + 1]
      : "node_modules/@openclaw/design-system/styles";
  if (!output || (!base && !workingTree) || !designSystemStyles) {
    throw new Error(
      "usage: source-check.ts (--base <sha> | --working-tree) --output <path> [--design-system-styles <dir>] [--fail-on-findings]",
    );
  }

  const diff = workingTree
    ? git("diff", "--unified=0", "--no-ext-diff", "HEAD", "--", "src")
    : git("diff", "--unified=0", "--no-ext-diff", `${base}..HEAD`, "--", "src");
  const findings = [
    ...(await undefinedTokenFindings(designSystemStyles)),
    ...changedLineFindings(parseAddedLines(diff)),
  ];
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify(
      {
        baseSha: workingTree ? git("rev-parse", "HEAD") : base,
        consumerSha: git("rev-parse", "HEAD"),
        findings,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote ${findings.length} deterministic findings to ${output}`);
  if (failOnFindings && findings.length > 0) {
    throw new Error(`post-agent deterministic checks found ${findings.length} violation(s)`);
  }
}

if (import.meta.main) {
  await main();
}
