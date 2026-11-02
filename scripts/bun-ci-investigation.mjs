import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const cwd = path.resolve(process.env.SOURCE_DIRECTORY);
const name = process.env.PROOF_REPOSITORY;
const tool = process.env.PROOF_TOOL;
const phase = process.env.PROOF_PHASE;
const bun = path.join(process.env.RUNNER_TEMP, "bun-ci-tools/bun-linux-x64/bun");
const packageFile = path.join(cwd, "package.json");
const original = fs.readFileSync(packageFile, "utf8");
const manifest = JSON.parse(original);
const manager = name === "clawhub" ? bun : "pnpm";
const samples = [];
const report = (kind, value) =>
  console.log(`BUN_CI_${kind} ${JSON.stringify({ name, tool, phase, ...value })}`);
const run = (label, executable, args, options = {}) => {
  const started = performance.now();
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    ...options,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const evidence = {
    label,
    command: [path.basename(executable), ...args],
    exit: result.status,
    signal: result.signal,
    error: result.error?.message,
    seconds: (performance.now() - started) / 1000,
    outputSha256: createHash("sha256").update(output).digest("hex"),
    outputBytes: Buffer.byteLength(output),
    output: output.slice(0, 2500).replaceAll(cwd, "<source>"),
  };
  samples.push(evidence);
  report("SAMPLE", evidence);
  return evidence;
};
const command = manifest.scripts["format:check"]
  ? "format:check"
  : manifest.scripts["fmt:ts:check"]
    ? "fmt:ts:check"
    : "check";
const formatScript = manifest.scripts[command];
assert(formatScript.includes("oxfmt --check"));
const nativeTypeScript = ["lobster", "clawpatch", "crabfleet"].includes(name);
const typeCommand = name === "crabfleet" ? "build" : "typecheck";
if (tool === "candidate") {
  manifest.scripts[command] = formatScript.replace("oxfmt --check", "bun fmt --no-script --check");
  if (nativeTypeScript)
    manifest.scripts[typeCommand] = manifest.scripts[typeCommand].replace(
      /\btsc\b/,
      "bun check --no-script",
    );
}
const indentation = original.match(/\n([\t ]+)"/)?.[1] ?? "  ";
const candidatePackage = `${JSON.stringify(manifest, null, indentation)}\n`;
fs.writeFileSync(packageFile, candidatePackage);
const expectSuccess = (result) => assert.equal(result.exit, 0, `${result.label}: ${result.output}`);
const expectFailure = (result) => assert(result.exit !== 0 && result.exit !== null, result.label);
const format = (label) => run(label, manager, ["run", command]);
const paired = (label, operation) => {
  if (tool !== "candidate") return;
  try {
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      const order = repetition % 2 ? ["baseline", "candidate"] : ["candidate", "baseline"];
      for (const selected of order) {
        fs.writeFileSync(packageFile, selected === "baseline" ? original : candidatePackage);
        expectSuccess(operation(`paired-${label}-${selected}-${repetition}`));
      }
    }
  } finally {
    fs.writeFileSync(packageFile, candidatePackage);
  }
};
let primaryError;
try {
  const head = run("source-head", "git", ["rev-parse", "HEAD"]).output.trim();
  assert.equal(head, process.env.SOURCE_SHA);
  report("ENVIRONMENT", {
    head,
    runner: process.env.RUNNER_OS,
    architecture: process.arch,
    node: process.version,
    manager: manifest.packageManager ?? "Bun 1.4.4",
    command,
    originalScript: formatScript,
    actualScript: manifest.scripts[command],
    nativeTypeScript,
    checkerScript: nativeTypeScript ? manifest.scripts[typeCommand] : null,
    cache:
      phase === "cold"
        ? "empty isolated dependency/tool cache"
        : "exact restored cache; fresh checkout and absent node_modules before install",
  });
  expectSuccess(format("format-first"));
  for (let repetition = 1; repetition <= 3; repetition += 1)
    expectSuccess(format(`format-hot-${repetition}`));
  paired("format", format);
  const fixtureDirectory = fs.mkdtempSync(
    path.join(cwd, name === "clickclack" ? "apps/web/src/bun-ci-proof-" : "bun-ci-proof-"),
  );
  const specimens = [
    [
      "imports.ts",
      'import zlib from "node:zlib";\n\nimport path from "node:path";\nimport fs from "node:fs";\nexport const value={zlib,path,fs}',
    ],
    ["view.tsx", "export const view=<section><strong>hello</strong><span>{1+2}</span></section>"],
    [
      "package.json",
      '{"version":"1.0.0","name":"format-control","scripts":{"z-last":"echo last","a-first":"echo first"}}',
    ],
    ["style.css", ".panel{display:flex;color:rgb(255,0,0);padding:0px 1rem}"],
    ["page.html", "<!doctype html><html><body><div><span>hello</span></div></body></html>"],
    ["readme.md", "# title\n\n-   item\n\n```ts\nconst value={number:1}\n```"],
    ["workflow.yml", "name: proof\nitems: [one,two,three]"],
  ];
  if (name === "clickclack")
    specimens.push([
      "Component.svelte",
      '<script lang="ts">let value:number=1</script>\n<h1>{value+1}</h1>',
    ]);
  const formatter = tool === "baseline" ? path.join(cwd, "node_modules/.bin/oxfmt") : bun;
  const formatterArgs = tool === "baseline" ? [] : ["fmt", "--no-script"];
  try {
    for (const [filename, input] of specimens) {
      const fixture = path.join(fixtureDirectory, filename);
      fs.writeFileSync(fixture, input);
      const negative = run(`negative-format-${filename}`, formatter, [
        ...formatterArgs,
        "--check",
        fixture,
      ]);
      if (negative.exit !== 1) report("FORMAT_INCONCLUSIVE", { filename, ...negative });
      assert.equal(
        negative.exit,
        1,
        `${filename}: expected formatting rejection, not an execution error`,
      );
      const written = run(`write-format-${filename}`, formatter, [
        ...formatterArgs,
        "--write",
        fixture,
      ]);
      expectSuccess(written);
      const contents = fs.readFileSync(fixture, "utf8");
      expectSuccess(
        run(`idempotent-format-${filename}`, formatter, [...formatterArgs, "--write", fixture]),
      );
      assert.equal(fs.readFileSync(fixture, "utf8"), contents);
      expectSuccess(
        run(`check-formatted-${filename}`, formatter, [...formatterArgs, "--check", fixture]),
      );
      report("FORMATTED", {
        filename,
        contents,
        sha256: createHash("sha256").update(contents).digest("hex"),
      });
      fs.unlinkSync(fixture);
    }
  } finally {
    fs.rmSync(fixtureDirectory, { recursive: true });
  }
  if (nativeTypeScript) {
    const check = (label) => run(label, manager, ["run", typeCommand]);
    expectSuccess(check("typecheck-first"));
    for (let repetition = 1; repetition <= 3; repetition += 1)
      expectSuccess(check(`typecheck-hot-${repetition}`));
    paired("typecheck", check);
    const fixture = path.join(cwd, "src/bun-ci-negative-control.ts");
    assert(!fs.existsSync(fixture));
    try {
      fs.writeFileSync(fixture, "export const bunCiTypeError: string = 42;\n");
      const negative = check("negative-type-assignment");
      expectFailure(negative);
      assert(negative.output.includes("2322"), negative.output);
      fs.writeFileSync(fixture, "export const = ;\n");
      expectFailure(check("negative-type-syntax"));
    } finally {
      fs.unlinkSync(fixture);
    }
    expectSuccess(check("typecheck-restored-clean"));
  }
  expectSuccess(format("format-restored-clean"));
  report("COMPLETE", { passed: true, samples: samples.length });
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  fs.writeFileSync(packageFile, original);
  const status = run("source-readonly", "git", ["status", "--porcelain", "--untracked-files=all"]);
  if (primaryError)
    report("FAILED_STATE", { originalFailure: primaryError.message, status: status.output });
  else assert.equal(status.output.trim(), "");
}
