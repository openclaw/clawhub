import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { hasSecretLikeValue } from "./normalize";

type Options = {
  snapshotDir: string;
};

type Finding = {
  file: string;
  line?: number;
  path: string;
  reason: string;
};

const HF_SPLITS = ["train", "validation", "test", "eval_holdout"] as const;
const RAW_CONVEX_REF_PATTERN = /\b(?:skillVersions|packageReleases):[a-z0-9]{6,}\b/i;
const RAW_STORAGE_PATH_PATTERN = /(^|\/)_storage\//;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const snapshotDir = resolve(options.snapshotDir);
  const findings: Finding[] = [];

  await assertFile(join(snapshotDir, "manifest.json"));
  await assertDirectory(join(snapshotDir, "hf-dataset", "data"));
  await inspectJsonFile(join(snapshotDir, "manifest.json"), snapshotDir, findings);

  for (const split of HF_SPLITS) {
    const file = join(snapshotDir, "hf-dataset", "data", `${split}.jsonl`);
    await assertFile(file);
    await inspectJsonlFile(file, snapshotDir, findings);
  }

  if (findings.length > 0) {
    for (const finding of findings.slice(0, 50)) {
      const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      console.error(`${location} ${finding.path}: ${finding.reason}`);
    }
    if (findings.length > 50) {
      console.error(`... ${findings.length - 50} additional guardrail findings omitted`);
    }
    throw new Error(`sanitized output guardrail check failed with ${findings.length} finding(s)`);
  }

  console.log("sanitized output guardrails passed");
}

async function assertDirectory(path: string) {
  const entry = await stat(path);
  if (!entry.isDirectory()) throw new Error(`Expected directory: ${path}`);
}

async function assertFile(path: string) {
  const entry = await stat(path);
  if (!entry.isFile()) throw new Error(`Expected file: ${path}`);
}

async function inspectJsonFile(path: string, root: string, findings: Finding[]) {
  const json = JSON.parse(await readFile(path, "utf8"));
  inspectValue(json, relative(root, path), "$", findings);
}

async function inspectJsonlFile(path: string, root: string, findings: Finding[]) {
  const file = relative(root, path);
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (line.trim() === "") continue;
    try {
      inspectValue(JSON.parse(line), file, "$", findings, lineNumber);
    } catch (error) {
      findings.push({
        file,
        line: lineNumber,
        path: "$",
        reason: `invalid JSONL row: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}

function inspectValue(
  value: unknown,
  file: string,
  path: string,
  findings: Finding[],
  line?: number,
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectValue(item, file, `${path}[${index}]`, findings, line));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (key === "storageId") {
        findings.push({
          file,
          line,
          path: childPath,
          reason: "raw storageId field is not allowed",
        });
      }
      if (key === "path" && typeof child === "string" && RAW_STORAGE_PATH_PATTERN.test(child)) {
        findings.push({
          file,
          line,
          path: childPath,
          reason: "raw _storage/ bundle path is not allowed",
        });
      }
      inspectValue(child, file, childPath, findings, line);
    }
    return;
  }

  if (typeof value !== "string") return;
  if (RAW_CONVEX_REF_PATTERN.test(value)) {
    findings.push({
      file,
      line,
      path,
      reason: "raw Convex document id reference is not allowed",
    });
  }
  if (hasSecretLikeValue(value)) {
    findings.push({
      file,
      line,
      path,
      reason: "obvious secret-like value is not allowed",
    });
  }
}

function parseArgs(args: string[]): Options {
  let snapshotDir: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--snapshot-dir") {
      snapshotDir = args[++index] ?? null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!snapshotDir) throw new Error("--snapshot-dir is required");
  return { snapshotDir };
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
